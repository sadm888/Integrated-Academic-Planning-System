"""ai_routes.py — AI Study Tools (per-document, no subject/semester dependency)

Every AI feature operates on a single selected PDF.  PDFs are user-scoped —
not tied to any subject or semester — so the same notes can be used regardless
of which classroom or semester they were originally filed under.

REST:
  POST   /api/ai/pdf/upload                      — upload + index a PDF from device
  GET    /api/ai/pdf/list                         — list user's indexed PDFs
  DELETE /api/ai/pdf/<pdf_id>                     — delete PDF + its ChromaDB index
  GET    /api/ai/pdf/list-resources               — list platform PDFs available to import
  POST   /api/ai/pdf/import-resource              — copy a platform PDF into AI index

  POST   /api/ai/pdf/<pdf_id>/summarize           — summarise the document
  POST   /api/ai/pdf/<pdf_id>/chat                — RAG chat with the document
  POST   /api/ai/pdf/<pdf_id>/quiz/generate       — generate quiz from the document
  POST   /api/ai/pdf/<pdf_id>/quiz/result         — persist a quiz result
  GET    /api/ai/pdf/<pdf_id>/flashcards/deck     — load saved flashcard deck
  POST   /api/ai/pdf/<pdf_id>/flashcards/deck     — save deck
  POST   /api/ai/pdf/<pdf_id>/flashcards/generate — generate flashcards
  POST   /api/ai/pdf/<pdf_id>/mindmap             — concept mind map
  POST   /api/ai/pdf/<pdf_id>/formula-sheet       — extract formulas / equations
  POST   /api/ai/pdf/<pdf_id>/past-paper-analyse  — topic frequency analysis
  POST   /api/ai/pdf/<pdf_id>/mock-test/generate  — timed mock test (with marks)
  POST   /api/ai/pdf/<pdf_id>/mock-paper/generate — pattern-aware mock paper
  POST   /api/ai/pdf/<pdf_id>/study-planner       — day-by-day study plan
  GET    /api/ai/pdf/<pdf_id>/performance         — quiz performance analytics

  POST   /api/ai/semester/<semester_id>/chat-summarise — classroom chat summary
"""

import os
import json
import shutil
import logging
import threading
import time
from uuid import uuid4
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from bson import ObjectId
from werkzeug.utils import secure_filename

from middleware import token_required, is_member_of_classroom

ai_bp = Blueprint('ai', __name__, url_prefix='/api/ai')
logger = logging.getLogger(__name__)

# ── Directories ────────────────────────────────────────────────────────────────
AI_PDF_DIR    = os.path.join(os.getcwd(), 'uploads', 'ai_pdfs')
CHROMA_DIR    = os.path.join(os.getcwd(), 'uploads', 'chroma_db')
ACADEMICS_DIR = os.path.join(os.getcwd(), 'uploads', 'academics')
os.makedirs(AI_PDF_DIR,    exist_ok=True)
os.makedirs(CHROMA_DIR,    exist_ok=True)
os.makedirs(ACADEMICS_DIR, exist_ok=True)

MAX_PDF_SIZE = 20 * 1024 * 1024  # 20 MB

# ── Lazy singletons ────────────────────────────────────────────────────────────
_embed_model     = None
_embed_lock      = threading.Lock()
_chroma_client   = None
_chroma_lock     = threading.Lock()
_groq_client     = None
_groq_lock       = threading.Lock()
_cross_encoder   = None   # None = not yet tried; False = load failed (sentinel)
_ce_lock         = threading.Lock()
_index_semaphore = threading.Semaphore(1)  # serialize ChromaDB writes
_bm25_cache: dict = {}   # pdf_id -> BM25Okapi instance (rebuilt when chunk count changes)
_bm25_cache_lock = threading.Lock()


def _get_ai_cache(db, pdf_id: str, feature: str):
    """Return cached AI result or None. feature = 'summary'|'mindmap'|'formula'|'topics'"""
    rec = db.ai_result_cache.find_one({'pdf_id': pdf_id, 'feature': feature})
    return rec['result'] if rec else None


def _set_ai_cache(db, pdf_id: str, feature: str, result):
    db.ai_result_cache.update_one(
        {'pdf_id': pdf_id, 'feature': feature},
        {'$set': {'result': result, 'cached_at': datetime.now(timezone.utc)}},
        upsert=True,
    )


def _invalidate_ai_cache(db, pdf_id: str):
    """Call when a PDF is re-indexed or deleted."""
    db.ai_result_cache.delete_many({'pdf_id': pdf_id})


def _get_embedder():
    global _embed_model
    if _embed_model is None:
        with _embed_lock:
            if _embed_model is None:
                from sentence_transformers import SentenceTransformer
                logger.info("Loading embedding model BAAI/bge-small-en-v1.5 …")
                _embed_model = SentenceTransformer('BAAI/bge-small-en-v1.5')
                logger.info("Embedding model loaded.")
    return _embed_model


def _get_chroma():
    global _chroma_client
    if _chroma_client is None:
        with _chroma_lock:
            if _chroma_client is None:
                import chromadb
                _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
    return _chroma_client


def _get_groq():
    global _groq_client
    if _groq_client is None:
        with _groq_lock:
            if _groq_client is None:
                from groq import Groq
                from config import Config
                key = Config.GROQ_API_KEY
                if not key:
                    raise RuntimeError('GROQ_API_KEY is not configured')
                _groq_client = Groq(api_key=key)
    return _groq_client


def _groq_complete(messages: list, max_tokens: int = 1000,
                   model: str = 'llama-3.3-70b-versatile', retries: int = 3) -> str:
    """
    Centralized AI completion with automatic retry on rate-limits and auth-error recovery.

    Why this exists: Groq free tier is 30 req/min. Without retries, a single 429 response
    causes ALL subsequent calls to fail instantly because the exception propagates up and the
    singleton client never resets.  This helper:
      - On 429 (rate limit): waits 15/30/45 s so the 1-minute window resets
      - On 401 (bad key):    clears the singleton so the key is re-read from config
      - On 5xx server error: short exponential backoff (2/4 s)
    Returns the content string directly; raises RuntimeError on auth failure or exhausted retries.
    """
    global _groq_client
    last_err = None
    for attempt in range(retries):
        try:
            return _get_groq().chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
            ).choices[0].message.content
        except Exception as exc:
            err_str = str(exc).lower()
            last_err = exc
            # ── Auth failure: clear singleton so next call re-reads key from .env ──
            if '401' in err_str or 'authentication' in err_str or 'invalid_api_key' in err_str:
                with _groq_lock:
                    _groq_client = None
                raise RuntimeError(
                    'AI service authentication failed. Check GROQ_API_KEY in .env.')
            # ── Rate limit: wait for the 1-minute window to reset ─────────────────
            if '429' in err_str or 'rate_limit' in err_str or 'too many' in err_str:
                wait = 15 * (attempt + 1)   # 15 s, 30 s, 45 s
                logger.warning(f"AI rate limit (attempt {attempt+1}/{retries}) — waiting {wait}s")
                time.sleep(wait)
            else:
                # Transient server error
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)   # 1 s, 2 s
    raise RuntimeError(f'AI service unavailable after {retries} attempts: {last_err}')


def _get_cross_encoder():
    """Lazy-load cross-encoder for reranking. Returns None if unavailable."""
    global _cross_encoder
    if _cross_encoder is None:
        with _ce_lock:
            if _cross_encoder is None:
                try:
                    from sentence_transformers.cross_encoder import CrossEncoder
                    logger.info("Loading cross-encoder ms-marco-MiniLM-L-6-v2 …")
                    _cross_encoder = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2', max_length=512)
                    logger.info("Cross-encoder loaded.")
                except Exception as exc:
                    logger.warning(f"Cross-encoder unavailable, reranking disabled: {exc}")
                    _cross_encoder = False  # sentinel: don't retry
    return _cross_encoder if _cross_encoder is not False else None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _check_pdf_access(db, pdf_id: str, user_id: str):
    """Raise ValueError if the user does not own this PDF."""
    doc = db.ai_user_pdfs.find_one({'pdf_id': pdf_id})
    if not doc:
        raise ValueError('PDF not found')
    if str(doc.get('user_id', '')) != str(user_id):
        raise ValueError('Access denied')
    return doc


def _collection_name(pdf_id: str) -> str:
    return f"pdf_{pdf_id}"


def _get_chunks(pdf_id: str) -> list:
    """Return all indexed text chunks for the PDF as a list."""
    try:
        col    = _get_chroma().get_or_create_collection(_collection_name(pdf_id))
        result = col.get(include=['documents'])
        return result.get('documents', [])
    except Exception as exc:
        logger.warning(f"_get_chunks failed for {pdf_id}: {exc}")
        return []


def _bm25_scores(pdf_id: str, chunks: list, query: str) -> list:
    """Return BM25 relevance scores. Index is cached per pdf_id and rebuilt when chunk count changes."""
    try:
        from rank_bm25 import BM25Okapi
        n = len(chunks)
        with _bm25_cache_lock:
            entry = _bm25_cache.get(pdf_id)
            if entry is None or entry[0] != n:
                tokenized = [c.lower().split() for c in chunks]
                _bm25_cache[pdf_id] = (n, BM25Okapi(tokenized))
            bm25 = _bm25_cache[pdf_id][1]
        return bm25.get_scores(query.lower().split()).tolist()
    except Exception as exc:
        logger.warning(f"BM25 scoring failed: {exc}")
        return [0.0] * len(chunks)


def _rerank(query: str, chunks: list, n: int) -> list:
    """Cross-encoder reranking. Falls back to original order if model unavailable."""
    if len(chunks) <= 1:
        return chunks[:n]
    ce = _get_cross_encoder()
    if ce is None:
        return chunks[:n]
    try:
        pairs  = [(query, chunk) for chunk in chunks]
        scores = ce.predict(pairs)
        ranked = sorted(zip(chunks, scores), key=lambda x: float(x[1]), reverse=True)
        return [c for c, _ in ranked[:n]]
    except Exception as exc:
        logger.warning(f"Reranking failed: {exc}")
        return chunks[:n]


def _hybrid_rag(pdf_id: str, query: str, n: int = 5, retries: int = 3) -> list:
    """
    Advanced RAG pipeline:
      1. Vector search  (top candidate_n results)
      2. BM25 keyword search over all chunks
      3. Reciprocal Rank Fusion (RRF) to merge both rankings
      4. Cross-encoder reranking of the RRF top results → final top-n
    Returns a list of n chunk strings.
    """
    candidate_n = n * 3

    # ── Stage 1: Vector search ────────────────────────────────────────────────
    embedder  = _get_embedder()
    q_vec     = embedder.encode([query], normalize_embeddings=True).tolist()[0]
    vec_chunks = []
    last_err   = None
    for attempt in range(retries):
        try:
            col   = _get_chroma().get_or_create_collection(_collection_name(pdf_id))
            count = col.count()
            if count == 0:
                return []
            res        = col.query(query_embeddings=[q_vec], n_results=min(candidate_n, count), include=['documents'])
            vec_chunks = res['documents'][0] if res.get('documents') else []
            break
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                time.sleep(0.4 * (attempt + 1))

    # Fetch all chunks once — reused for BM25 and as vector-search fallback
    all_chunks = _get_chunks(pdf_id)

    if not vec_chunks:
        if last_err:
            logger.warning(f"_hybrid_rag vector search failed for {pdf_id}: {last_err}")
        # Fall back to BM25-only when vector search is completely unavailable
        if not all_chunks:
            return []
        bm25_raw    = _bm25_scores(pdf_id, all_chunks, query)
        bm25_ranked = sorted(range(len(all_chunks)), key=lambda i: bm25_raw[i], reverse=True)[:candidate_n]
        return _rerank(query, [all_chunks[i] for i in bm25_ranked], n)

    # ── Stage 2 & 3: BM25 + RRF ──────────────────────────────────────────────
    rrf: dict = {}
    for rank, chunk in enumerate(vec_chunks):
        rrf[chunk] = rrf.get(chunk, 0.0) + 1.0 / (rank + 60)

    if all_chunks:
        bm25_raw    = _bm25_scores(pdf_id, all_chunks, query)
        bm25_ranked = sorted(enumerate(bm25_raw), key=lambda x: x[1], reverse=True)[:candidate_n]
        for rank, (idx, score) in enumerate(bm25_ranked):
            if score > 0:
                chunk = all_chunks[idx]
                rrf[chunk] = rrf.get(chunk, 0.0) + 1.0 / (rank + 60)

    candidates = [c for c, _ in sorted(rrf.items(), key=lambda x: x[1], reverse=True)][:candidate_n]

    # ── Stage 4: Cross-encoder reranking ─────────────────────────────────────
    return _rerank(query, candidates, n)


def _rag_search(pdf_id: str, query: str, n: int = 5, retries: int = 3):
    """
    Public retrieval entry point — runs the full hybrid pipeline and tracks metrics.
    Returns {'documents': [[...]], 'metadatas': [[]]} for backward compatibility.
    """
    t0     = time.time()
    chunks = _hybrid_rag(pdf_id, query, n=n, retries=retries)
    latency = round((time.time() - t0) * 1000, 1)
    threading.Thread(target=_track_rag_metric, args=(pdf_id, len(chunks), latency), daemon=True).start()
    return {'documents': [chunks], 'metadatas': [[{}] * len(chunks)]}


def _get_all_text(pdf_id: str, max_chars: int = 14000) -> str:
    """Return all indexed text for the PDF (used when RAG finds no chunks)."""
    return '\n\n'.join(_get_chunks(pdf_id))[:max_chars]


def _track_rag_metric(pdf_id: str, chunks_retrieved: int, latency_ms: float):
    """Persist a single RAG query metric (non-critical, fire-and-forget)."""
    try:
        from database import get_db
        get_db().ai_rag_metrics.insert_one({
            'pdf_id':           pdf_id,
            'chunks_retrieved': chunks_retrieved,
            'latency_ms':       latency_ms,
            'ts':               datetime.now(timezone.utc),
        })
    except Exception:
        pass


def _parse_json_response(raw: str):
    """Extract JSON from an LLM response that may be wrapped in markdown fences."""
    raw = raw.strip()
    for fence in ('```json', '```'):
        if fence in raw:
            raw = raw.split(fence, 1)[1].rsplit('```', 1)[0].strip()
            break
    return json.loads(raw)


def _clean_prose(text: str) -> str:
    """Strip markdown formatting from LLM prose responses (not JSON)."""
    import re
    text = text.replace('`', '').replace('***', '').replace('**', '').replace('__', '')
    return re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)


def _index_pdf(path: str, pdf_id: str):
    """Background: extract, chunk, embed and store a PDF in its own ChromaDB collection."""
    from database import get_db
    logger.info(f"Indexing PDF {pdf_id} …")
    with _index_semaphore:  # serialize writes to avoid ChromaDB lock contention
        try:
            import fitz  # PyMuPDF
            doc  = fitz.open(path)
            text = '\n'.join(page.get_text() for page in doc)
            doc.close()

            words      = text.split()
            chunk_size = 400
            overlap    = 80
            chunks, metas, ids = [], [], []

            for i in range(0, max(1, len(words) - overlap), chunk_size - overlap):
                chunk = ' '.join(words[i: i + chunk_size])
                if len(chunk.strip()) < 50:
                    continue
                idx = len(chunks)
                chunks.append(chunk)
                metas.append({'pdf_id': pdf_id, 'chunk_index': idx})
                ids.append(f"{pdf_id}_c{idx}")

            if chunks:
                embedder = _get_embedder()
                vecs     = embedder.encode(chunks, normalize_embeddings=True, batch_size=32).tolist()
                col      = _get_chroma().get_or_create_collection(_collection_name(pdf_id))
                col.add(documents=chunks, embeddings=vecs, metadatas=metas, ids=ids)

            get_db().ai_user_pdfs.update_one(
                {'pdf_id': pdf_id},
                {'$set': {'indexed': True, 'chunk_count': len(chunks)}},
            )
            logger.info(f"Indexed {len(chunks)} chunks for PDF {pdf_id}")
        except Exception as exc:
            logger.exception(f"Indexing failed for {pdf_id}: {exc}")
            try:
                get_db().ai_user_pdfs.update_one({'pdf_id': pdf_id}, {'$set': {'index_error': str(exc)}})
            except Exception:
                pass


# ══════════════════════════════════════════════════════════════════════════════
# PDF management (user-scoped, no subject/semester)
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/upload', methods=['POST'])
@token_required
def upload_pdf():
    from database import get_db
    user_id = request.user['user_id']
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Only PDF files are accepted'}), 400
    if request.content_length and request.content_length > MAX_PDF_SIZE:
        return jsonify({'error': 'File exceeds 20 MB limit'}), 413

    pdf_id   = str(uuid4())
    filename = secure_filename(file.filename)
    dst      = os.path.join(AI_PDF_DIR, f'{pdf_id}.pdf')
    file.save(dst)
    size = os.path.getsize(dst)

    if size > MAX_PDF_SIZE:
        os.remove(dst)
        return jsonify({'error': 'File exceeds 20 MB limit'}), 413

    db = get_db()
    db.ai_user_pdfs.insert_one({
        'pdf_id':      pdf_id,
        'user_id':     user_id,
        'filename':    filename,
        'stored':      f'{pdf_id}.pdf',
        'size':        size,
        'indexed':     False,
        'source':      'upload',
        'uploaded_at': datetime.now(timezone.utc),
    })

    threading.Thread(target=_index_pdf, args=(dst, pdf_id), daemon=True).start()
    return jsonify({'pdf_id': pdf_id, 'filename': filename, 'size': size}), 201


@ai_bp.route('/pdf/list', methods=['GET'])
@token_required
def list_pdfs():
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    pdfs    = list(db.ai_user_pdfs.find(
        {'user_id': user_id},
        {'_id': 0, 'pdf_id': 1, 'filename': 1, 'size': 1, 'indexed': 1,
         'source': 1, 'chunk_count': 1, 'uploaded_at': 1},
    ).sort('uploaded_at', -1).limit(100))
    for p in pdfs:
        if p.get('uploaded_at'):
            p['uploaded_at'] = p['uploaded_at'].isoformat()
    return jsonify({'pdfs': pdfs}), 200


@ai_bp.route('/pdf/<pdf_id>', methods=['DELETE'])
@token_required
def delete_pdf(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        doc = _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    # Remove file
    path = os.path.join(AI_PDF_DIR, doc.get('stored', f'{pdf_id}.pdf'))
    if os.path.exists(path):
        os.remove(path)

    # Remove ChromaDB collection
    try:
        _get_chroma().delete_collection(_collection_name(pdf_id))
    except Exception:
        pass

    db.ai_user_pdfs.delete_one({'pdf_id': pdf_id})
    db.flashcard_decks.delete_many({'pdf_id': pdf_id, 'user_id': user_id})
    _invalidate_ai_cache(db, pdf_id)
    return jsonify({'message': 'Deleted'}), 200


@ai_bp.route('/pdf/list-resources', methods=['GET'])
@token_required
def list_resource_pdfs():
    """List all PDF resources the user can access: academic files + chat attachments."""
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()

    # Use identical query pattern to all_resources in academic_routes (known working)
    classrooms = list(db.classrooms.find({'members': ObjectId(user_id)}, {'_id': 1}))
    classroom_ids = [str(c['_id']) for c in classrooms]

    semesters = list(db.semesters.find(
        {'classroom_id': {'$in': classroom_ids}},
        {'_id': 1},
    ))
    semester_ids = [str(s['_id']) for s in semesters]

    # Already-imported resource_ids for deduplication
    imported_ids = {
        str(p.get('resource_id', ''))
        for p in db.ai_user_pdfs.find(
            {'user_id': user_id},
            {'resource_id': 1},
        )
        if p.get('resource_id')
    }

    results = []

    # ── 1. Academic file resources ────────────────────────────────────────────
    # Fields: name, mime_type, stored_name, size  (NOT filename/content_type)
    ac_resources = list(db.academic_resources.find(
        {
            'semester_id': {'$in': semester_ids},
            '$or': [
                {'name':      {'$regex': r'\.pdf$', '$options': 'i'}},
                {'mime_type': 'application/pdf'},
                {'stored_name': {'$regex': r'\.pdf$', '$options': 'i'}},
            ],
        },
        {'_id': 1, 'name': 1, 'size': 1, 'stored_name': 1},
    ).sort('name', 1).limit(200))
    logger.info(f"[list-resources] ac_resources={len(ac_resources)}")

    for r in ac_resources:
        rid = str(r['_id'])
        # Derive a clean display name: use 'name', fall back to stored_name without prefix
        raw_name = r.get('name') or r.get('stored_name', 'Unknown.pdf')
        # stored_name format: TIMESTAMP_USERID_originalname.pdf — strip the prefix
        if not r.get('name') and '_' in raw_name:
            parts = raw_name.split('_', 2)
            raw_name = parts[2] if len(parts) == 3 else raw_name
        results.append({
            'resource_id':      rid,
            'filename':         raw_name,
            'size':             r.get('size', 0),
            'source_type':      'academic',
            'already_imported': rid in imported_ids,
        })

    # ── 2. Chat PDF attachments ───────────────────────────────────────────────
    chat_pdfs = list(db.chat_messages.find(
        {
            'semester_id': {'$in': semester_ids},
            '$or': [
                {'file.mime_type': 'application/pdf'},
                {'file.name': {'$regex': r'\.pdf$', '$options': 'i'}},
            ],
        },
        {'_id': 1, 'file': 1, 'semester_id': 1},
    ).sort('_id', -1).limit(200))
    logger.info(f"[list-resources] chat_pdfs={len(chat_pdfs)}")

    # Deduplicate chat PDFs by normalised filename (keep newest per name)
    seen_names: set = set()
    for m in chat_pdfs:
        f = m.get('file') or {}
        name = f.get('name', 'attachment.pdf')
        norm = name.lower().strip()
        if norm in seen_names:
            continue
        seen_names.add(norm)
        rid = str(m['_id'])
        results.append({
            'resource_id':      rid,
            'filename':         name,
            'size':             f.get('size', 0),
            'source_type':      'chat',
            'already_imported': rid in imported_ids,
        })

    return jsonify({'resources': results}), 200


@ai_bp.route('/pdf/import-resource', methods=['POST'])
@token_required
def import_resource_pdf():
    from database import get_db
    user_id     = request.user['user_id']
    data        = request.get_json(force=True, silent=True) or {}
    resource_id = data.get('resource_id', '').strip()
    source_type = data.get('source_type', 'academic')
    if not resource_id:
        return jsonify({'error': 'resource_id is required'}), 400

    db = get_db()

    # Already imported?
    existing = db.ai_user_pdfs.find_one({'user_id': user_id, 'resource_id': resource_id})
    if existing:
        return jsonify({'pdf_id': existing['pdf_id'], 'filename': existing['filename'], 'already_existed': True}), 200

    # ── Resolve source file ────────────────────────────────────────────────────
    if source_type == 'chat':
        try:
            msg = db.chat_messages.find_one({'_id': ObjectId(resource_id)})
        except Exception:
            return jsonify({'error': 'Invalid resource_id'}), 400
        if not msg:
            return jsonify({'error': 'Chat message not found'}), 404
        f = msg.get('file') or {}
        rel_path = f.get('path', '')
        # path is stored as e.g. "uploads\chat\..." — normalise to absolute
        rel_path = rel_path.replace('\\', '/')
        src = os.path.join(os.getcwd(), rel_path) if not os.path.isabs(rel_path) else rel_path
        if not rel_path or not os.path.exists(src):
            return jsonify({'error': 'File not found on disk'}), 404
        filename = f.get('name', 'attachment.pdf')
    else:
        # academic resource
        try:
            resource = db.academic_resources.find_one({'_id': ObjectId(resource_id)})
        except Exception:
            return jsonify({'error': 'Invalid resource_id'}), 400
        if not resource:
            return jsonify({'error': 'Resource not found'}), 404
        stored = resource.get('stored_name', '')
        src    = os.path.join(ACADEMICS_DIR, stored)
        if not stored or not os.path.exists(src):
            return jsonify({'error': 'File not found on disk'}), 404
        filename = resource.get('name') or stored

    pdf_id = str(uuid4())
    dst    = os.path.join(AI_PDF_DIR, f'{pdf_id}.pdf')
    shutil.copy2(src, dst)

    db.ai_user_pdfs.insert_one({
        'pdf_id':      pdf_id,
        'user_id':     user_id,
        'filename':    filename,
        'stored':      f'{pdf_id}.pdf',
        'size':        os.path.getsize(dst),
        'indexed':     False,
        'source':      source_type,
        'resource_id': resource_id,
        'uploaded_at': datetime.now(timezone.utc),
    })

    threading.Thread(target=_index_pdf, args=(dst, pdf_id), daemon=True).start()
    return jsonify({'pdf_id': pdf_id, 'filename': filename, 'size': os.path.getsize(dst)}), 201


# ══════════════════════════════════════════════════════════════════════════════
# Summarize
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/summarize', methods=['POST'])
@token_required
def summarize_pdf(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        doc = _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data          = request.get_json(force=True, silent=True) or {}
    force_refresh = bool(data.get('force_refresh', False))

    if not force_refresh:
        cached = _get_ai_cache(db, pdf_id, 'summary')
        if cached:
            return jsonify({'summary': cached, 'filename': doc['filename'], 'cached': True}), 200

    text = _get_all_text(pdf_id, max_chars=20000)
    if not text:
        return jsonify({'error': 'PDF not yet indexed. Please wait a moment and try again.'}), 400

    prompt = f"""Summarise the following academic document topic by topic. Be thorough — cover ALL major topics without skipping anything.

Format rules (strictly enforced):
- Start with a one-line OVERVIEW of the whole document
- Then list each major topic covered, one by one
- For each topic: write the topic name in ALL CAPS on its own line, then 2-4 bullet points under it using a hyphen (-)
- NO **, NO *, NO #, NO backticks, NO markdown symbols of any kind
- Plain text only

Example format:
OVERVIEW
This document covers X and Y.

TOPIC NAME ONE
- point about this topic
- another point

TOPIC NAME TWO
- point about this topic
- another point

Document:
{text}"""

    try:
        cleaned = _clean_prose(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=1200))
        _set_ai_cache(db, pdf_id, 'summary', cleaned)
        return jsonify({'summary': cleaned, 'filename': doc['filename']}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except Exception as e:
        logger.error(f"Summarize error: {e}")
        return jsonify({'error': 'Failed to summarise'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# RAG Chat
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/chat', methods=['POST'])
@token_required
def chat_with_pdf(pdf_id):
    from database import get_db
    user_id  = request.user['user_id']
    db       = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data          = request.get_json(force=True, silent=True) or {}
    question      = (data.get('question') or '').strip()
    history       = data.get('history', [])
    deep_research = bool(data.get('deep_research', False))
    plan_mode     = bool(data.get('plan_mode', False))
    attachment    = data.get('attachment')  # {type, name, content}

    if not question and not attachment:
        return jsonify({'error': 'question is required'}), 400

    rag_n = 10 if deep_research else 5
    results = _rag_search(pdf_id, question or (attachment or {}).get('name', ''), n=rag_n)
    chunks  = results['documents'][0] if results.get('documents') else []
    metas   = results['metadatas'][0]  if results.get('metadatas')  else []
    context = '\n\n---\n\n'.join(chunks) if chunks else ''
    sources = [{'chunk_index': m.get('chunk_index')} for m in metas]

    if plan_mode:
        system_msg = (
            "You are a study planner AI. Help the student create structured, actionable study plans. "
            "Break topics into sessions, estimate time, and prioritise based on importance. "
            "Use the document excerpts for topic context where available. "
            "Be practical and motivating."
        )
    elif deep_research:
        system_msg = (
            "You are an expert academic research assistant. Give thorough, detailed, well-sourced answers. "
            "Use the document excerpts as primary context. Supplement with general knowledge freely. "
            "Explain concepts deeply, mention edge cases, and connect related ideas."
        )
    else:
        system_msg = (
            "You are a friendly, knowledgeable AI study assistant. "
            "You have access to document excerpts as additional context, but you are NOT limited to them. "
            "Answer every question using your full knowledge — treat the document excerpts as supplementary material, not a constraint. "
            "For greetings, casual messages, or off-topic chat, respond naturally and conversationally. "
            "NEVER say 'the provided context does not contain', 'not in the document', 'the context does not', or any similar phrase. "
            "NEVER refuse or redirect based on document content. Just answer helpfully. "
            "Be concise, warm, and student-friendly."
        )

    messages = [{'role': 'system', 'content': system_msg}]
    for h in history[-12:]:
        messages.append({'role': h['role'], 'content': h['content']})

    # Build user message
    ctx_block  = f"[Reference material from the selected document — use if relevant, ignore if not]\n{context}\n\n" if context else ""
    att_block  = ""
    use_vision = False

    if attachment:
        att_type = attachment.get('type', 'file')
        att_name = attachment.get('name', 'attachment')
        att_content = attachment.get('content', '')
        if att_type == 'image':
            use_vision = True
        else:
            # Text file — include first 3000 chars
            text_snippet = att_content[:3000] if att_content else ''
            att_block = f"Attached file ({att_name}):\n{text_snippet}\n\n"

    user_text = f"{ctx_block}{att_block}Question: {question}" if question else f"{ctx_block}{att_block}Describe what you see or analyse this content."

    if use_vision:
        # Use vision-capable model
        image_url = attachment.get('content', '')  # base64 data URL
        messages.append({
            'role': 'user',
            'content': [
                {'type': 'image_url', 'image_url': {'url': image_url}},
                {'type': 'text', 'text': question or 'Describe this image in an academic context.'},
            ]
        })
        model = 'meta-llama/llama-4-scout-17b-16e-instruct'
    else:
        messages.append({'role': 'user', 'content': user_text})
        model = 'llama-3.3-70b-versatile'

    try:
        answer = _clean_prose(_groq_complete(
            messages, max_tokens=1600 if deep_research else 800, model=model))
        return jsonify({'answer': answer, 'sources': sources}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return jsonify({'error': 'Failed to answer'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Quiz
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/quiz/generate', methods=['POST'])
@token_required
def generate_quiz(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data          = request.get_json(force=True, silent=True) or {}
    num_questions = max(1, min(int(data.get('num_questions', 10)), 50))
    types         = data.get('types', ['mcq', 'true_false', 'short']) or ['mcq']
    difficulty    = data.get('difficulty', 'mixed')

    text = _get_all_text(pdf_id, max_chars=14000)
    if not text:
        return jsonify({'error': 'PDF not yet indexed.'}), 400

    # Pass 1: extract deep conceptual structure from the document
    analysis_prompt = f"""You are an expert educator analysing an academic document to prepare a quiz.

Read this document carefully and extract:
1. The 6-10 most important concepts, principles, or mechanisms (things a student MUST understand)
2. Key cause-and-effect relationships (why things happen)
3. Common misconceptions or tricky distinctions students confuse
4. Any processes, algorithms, or step-by-step procedures
5. Definitions that are subtle or nuanced

Document:
{text}

Return a concise plain-text analysis (no JSON, no bullet points, just dense paragraphs). Focus on what would trip up a student who only memorised surface facts."""

    analysis = _groq_complete(
        [{'role': 'user', 'content': analysis_prompt}], max_tokens=800).strip()

    # Pass 2: generate questions using both the raw text and the conceptual analysis
    diff_instruction = {
        'easy':   'All questions should be straightforward recall or basic understanding.',
        'medium': 'Mix recall with application and reasoning questions.',
        'hard':   'Prioritise application, analysis, and questions that expose common misconceptions.',
        'mixed':  'Distribute evenly: some recall (easy), some application (medium), some analysis/tricky (hard).',
    }.get(difficulty, 'Distribute across difficulty levels.')

    types_str = ', '.join(types)
    prompt = f"""You are an expert quiz writer. Using the document text AND the conceptual analysis below, generate exactly {num_questions} high-quality quiz questions.

CONCEPTUAL ANALYSIS (use this to make questions test real understanding, not just memorisation):
{analysis}

ORIGINAL DOCUMENT:
{text[:8000]}

QUESTION QUALITY RULES (strictly follow these):
- Do NOT ask trivial lookup questions ("What is X defined as?" is bad unless the definition is subtle)
- DO ask "why", "how", "what would happen if", "which of these is NOT", scenario-based questions
- For MCQ: distractors must be plausible — use common misconceptions or close-but-wrong alternatives
- For short: ask questions that need a reasoned 1-2 sentence answer, not a one-word recall
- For true_false: make the false statements subtly wrong, not obviously wrong
- NEVER use "All of the above", "None of the above", or "Both A and B" as options
- Each question must test a DIFFERENT concept — no repetition
- {diff_instruction}

Return ONLY a valid JSON array. Each object must have:
- "type": one of {json.dumps(types)}
- "question": the question text (make it clear and specific)
- "options": array of 4 strings (mcq/true_false/multi_mcq only — true_false always ["True","False"])
- "answer": correct answer string (mcq/true_false/fill_blank) or array of strings (multi_mcq)
- "explanation": 2-sentence explanation — state WHY the answer is correct AND why the main distractor is wrong
- "topic": specific concept this question tests
- "difficulty": "easy", "medium", or "hard"

Return only the JSON array, no other text."""

    try:
        questions = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=4000))
        return jsonify({'questions': questions}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI returned malformed JSON. Please try again.'}), 500
    except Exception as e:
        logger.error(f"Quiz generation error: {e}")
        return jsonify({'error': 'Failed to generate quiz'}), 500


@ai_bp.route('/pdf/<pdf_id>/quiz/result', methods=['POST'])
@token_required
def save_quiz_result(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data = request.get_json(force=True, silent=True) or {}
    db.quiz_results.insert_one({
        'pdf_id':             pdf_id,
        'user_id':            user_id,
        'score':              int(data.get('score', 0)),
        'total':              int(data.get('total', 0)),
        'question_count':     int(data.get('question_count', 0)),
        'types_used':         data.get('types_used', []),
        'weak_topics':        data.get('weak_topics', []),
        'difficulty_breakdown': data.get('difficulty_breakdown', {}),
        'created_at':         datetime.now(timezone.utc),
    })
    return jsonify({'message': 'Result saved'}), 201


@ai_bp.route('/pdf/<pdf_id>/quiz/grade', methods=['POST'])
@token_required
def grade_short_answers(pdf_id):
    """AI-grade short/long answers with partial marking (score 0.0–1.0)."""
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data    = request.get_json(force=True, silent=True) or {}
    answers = data.get('answers', [])  # [{question, model_answer, student_answer, marks}]
    if not answers:
        return jsonify({'grades': []}), 200

    items_text = '\n'.join(
        f"{i+1}. Question: {a['question']}\n   Model answer: {a.get('model_answer','')}\n   Student answer: {a.get('student_answer','')}\n   Max marks: {a.get('marks', 1)}"
        for i, a in enumerate(answers)
    )

    prompt = f"""You are an examiner grading student short/long answers. For each question below, compare the student's answer against the model answer and assign a score with partial marking.

{items_text}

Grading rules:
- Score is a decimal between 0.0 and 1.0 (proportion of marks earned, e.g. 0.5 = half marks)
- 1.0 = fully correct or covers all key points
- 0.5–0.9 = partially correct — key idea present but missing details or minor errors
- 0.1–0.4 = some relevant content but mostly wrong or very incomplete
- 0.0 = completely wrong, blank, or irrelevant
- Grade on correctness of concepts, not exact wording
- Provide brief feedback (1 sentence) explaining the score

Return ONLY a valid JSON array with exactly {len(answers)} objects, each:
{{"index": 0, "score": 0.75, "feedback": "Correct concept but missed the key mechanism."}}

Return only the JSON array."""

    try:
        grades = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=800))
        # Persist grades so performance analytics can track short-answer scores
        try:
            db.quiz_grades.insert_one({
                'pdf_id':     pdf_id,
                'user_id':    user_id,
                'grades':     grades,
                'created_at': datetime.now(timezone.utc),
            })
        except Exception:
            pass
        return jsonify({'grades': grades}), 200
    except Exception as e:
        logger.error(f"Grading error: {e}")
        return jsonify({'error': 'Failed to grade answers'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Flashcards
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/flashcards/generate', methods=['POST'])
@token_required
def generate_flashcards(pdf_id):
    from database import get_db
    user_id   = request.user['user_id']
    db        = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data      = request.get_json(force=True, silent=True) or {}
    num_cards = max(1, min(int(data.get('num_cards', 20)), 40))

    text = _get_all_text(pdf_id, max_chars=14000)
    if not text:
        return jsonify({'error': 'PDF not yet indexed.'}), 400

    # Pass 1: identify what's actually worth memorising
    analysis_prompt = f"""You are an expert educator preparing flashcards for a student.

Read this document and identify:
1. Core concepts the student must be able to define AND explain (not just name)
2. Cause-and-effect relationships and the reasoning behind them
3. Processes or procedures with the logic of each step
4. Subtle distinctions students commonly confuse (e.g. X vs Y)
5. Formulas, rules, or conditions — including when they apply and when they don't
6. "Why" knowledge: not just what something is, but why it works that way

Document:
{text}

Write a concise plain-text analysis listing all the above. Be specific — name the actual concepts, not generic categories."""

    analysis = _groq_complete(
        [{'role': 'user', 'content': analysis_prompt}], max_tokens=700).strip()

    prompt = f"""You are an expert educator creating high-quality spaced-repetition flashcards.

Using the conceptual analysis AND the original document, generate exactly {num_cards} flashcards.

CONCEPTUAL ANALYSIS:
{analysis}

ORIGINAL DOCUMENT:
{text[:8000]}

FLASHCARD QUALITY RULES:
- Front: ask a question that prompts RECALL and REASONING, not just recognition. Use "Why", "How", "What happens when", "What is the difference between X and Y", not just "Define X"
- Back: give a complete, self-contained answer. For explanations, include the mechanism or reason — not just the fact. Max 70 words.
- Cover every major concept from the analysis — no concept should appear twice
- Mix card types: definitions, comparisons, cause-effect, process steps, application scenarios
- Make the front specific enough that there is only ONE correct answer
- For formulas/rules: the front should ask when/why to use it, not just what it is

Return ONLY a valid JSON array. Each object must have:
- "front": question (max 25 words)
- "back": answer with brief reasoning where relevant (max 70 words)
- "topic": the concept this card covers (2-4 words)
- "type": one of "definition", "comparison", "cause_effect", "process", "application", "formula"

Return only the JSON array, no other text."""

    try:
        cards = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=4000))
        now = datetime.now(timezone.utc).isoformat()
        for card in cards:
            card.update({'ease': 2.5, 'interval': 1, 'repetitions': 0, 'next_review': now})
        return jsonify({'cards': cards}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI returned malformed JSON. Please try again.'}), 500
    except Exception as e:
        logger.error(f"Flashcard generation error: {e}")
        return jsonify({'error': 'Failed to generate flashcards'}), 500


@ai_bp.route('/pdf/<pdf_id>/flashcards/deck', methods=['GET'])
@token_required
def get_deck(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    deck = db.flashcard_decks.find_one({'pdf_id': pdf_id, 'user_id': user_id})
    return jsonify({'cards': deck.get('cards', []) if deck else []}), 200


@ai_bp.route('/pdf/<pdf_id>/flashcards/deck', methods=['POST'])
@token_required
def save_deck(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    cards = (request.get_json(force=True, silent=True) or {}).get('cards', [])
    db.flashcard_decks.replace_one(
        {'pdf_id': pdf_id, 'user_id': user_id},
        {'pdf_id': pdf_id, 'user_id': user_id, 'cards': cards, 'updated_at': datetime.now(timezone.utc)},
        upsert=True,
    )
    return jsonify({'message': 'Deck saved'}), 200


# ══════════════════════════════════════════════════════════════════════════════
# Mind Map
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/mindmap', methods=['POST'])
@token_required
def generate_mindmap(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data          = request.get_json(force=True, silent=True) or {}
    force_refresh = bool(data.get('force_refresh', False))

    if not force_refresh:
        cached = _get_ai_cache(db, pdf_id, 'mindmap')
        if cached:
            return jsonify({**cached, 'cached': True}), 200

    text = _get_all_text(pdf_id, max_chars=10000)
    if not text:
        return jsonify({'error': 'PDF not yet indexed.'}), 400

    prompt = f"""Analyse the following academic content and generate a comprehensive mind map.

Return ONLY a valid JSON object:
{{
  "center": "Main topic/title of the document",
  "branches": [
    {{
      "label": "Branch topic name",
      "subnodes": ["subtopic or key point 1", "subtopic or key point 2", "subtopic or key point 3"]
    }}
  ]
}}

Create 4–8 branches. Each branch should have 3–5 subnodes.
Cover all major topics. Be concise — each node should be ≤8 words.

Content:
{text}

Return only the JSON object, no other text."""

    try:
        mindmap = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=1500))
        _set_ai_cache(db, pdf_id, 'mindmap', mindmap)
        return jsonify(mindmap), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI returned malformed JSON. Please try again.'}), 500
    except Exception as e:
        logger.error(f"Mindmap error: {e}")
        return jsonify({'error': 'Failed to generate mind map'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Formula Sheet
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/formula-sheet', methods=['POST'])
@token_required
def formula_sheet(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data          = request.get_json(force=True, silent=True) or {}
    force_refresh = bool(data.get('force_refresh', False))

    if not force_refresh:
        cached = _get_ai_cache(db, pdf_id, 'formula')
        if cached is not None:
            return jsonify({'formulas': cached, 'cached': True}), 200

    # Use RAG to find formula-dense sections
    query   = "equations formulas mathematical expressions constants variables"
    results = _rag_search(pdf_id, query, n=8)
    chunks  = results['documents'][0] if results.get('documents') else []
    context = '\n\n'.join(chunks) if chunks else _get_all_text(pdf_id, max_chars=8000)

    if not context:
        return jsonify({'error': 'PDF not yet indexed.'}), 400

    prompt = f"""Extract all formulas, equations, and mathematical expressions from the following content.

Return ONLY a valid JSON array. Each object must have:
- "name": name or description of the formula
- "formula": the formula itself (use plain text, e.g. F = ma, E = mc^2)
- "variables": what each variable/symbol means (one line)
- "context": when/where this formula is used (one sentence)
- "topic": the chapter or topic this formula belongs to (e.g. "Thermodynamics", "Kinematics", "Wave Optics")

Content:
{context}

Return only the JSON array. If no formulas found, return an empty array []."""

    try:
        formulas = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=2000))
        _set_ai_cache(db, pdf_id, 'formula', formulas)
        return jsonify({'formulas': formulas}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI returned malformed JSON. Please try again.'}), 500
    except Exception as e:
        logger.error(f"Formula sheet error: {e}")
        return jsonify({'error': 'Failed to extract formulas'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Past Paper Topic Analyser
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/past-paper-analyse', methods=['POST'])
@token_required
def past_paper_analyse(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data          = request.get_json(force=True, silent=True) or {}
    force_refresh = bool(data.get('force_refresh', False))

    if not force_refresh:
        cached = _get_ai_cache(db, pdf_id, 'topics')
        if cached is not None:
            return jsonify({'topics': cached, 'cached': True}), 200

    text = _get_all_text(pdf_id, max_chars=12000)
    if not text:
        return jsonify({'error': 'PDF not yet indexed.'}), 400

    prompt = f"""Analyse the following academic document and identify all major topics covered.
Count how many times each topic appears or is discussed.

Return ONLY a valid JSON array, sorted by frequency descending. Each object must have:
- "topic": topic name
- "frequency": integer count of occurrences/mentions
- "percentage": approximate percentage of content dedicated to this topic
- "subtopics": array of 2–4 subtopic strings
- "importance": "high", "medium", or "low" based on how much it is covered

Content:
{text}

Return only the JSON array, no other text."""

    try:
        topics = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=2000))
        _set_ai_cache(db, pdf_id, 'topics', topics)
        return jsonify({'topics': topics}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI returned malformed JSON. Please try again.'}), 500
    except Exception as e:
        logger.error(f"Past paper analyse error: {e}")
        return jsonify({'error': 'Failed to analyse topics'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Mock Test (timed, marks, optional negative marking)
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/mock-test/generate', methods=['POST'])
@token_required
def generate_mock_test(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data             = request.get_json(force=True, silent=True) or {}
    num_questions    = max(5, min(int(data.get('num_questions', 10)), 50))
    marks_each       = max(1, int(data.get('marks_each', 1)))
    negative_marking = bool(data.get('negative_marking', False))
    negative_fraction = float(data.get('negative_fraction', 0.25))
    duration_minutes = max(5, int(data.get('duration_minutes', 30)))

    text = _get_all_text(pdf_id, max_chars=14000)
    if not text:
        return jsonify({'error': 'PDF not yet indexed.'}), 400

    analysis = _groq_complete(
        [{'role': 'user', 'content': f"Analyse this academic document. List the key concepts, mechanisms, cause-effect relationships, and common misconceptions a student must understand. Be specific and concise.\n\n{text}"}],
        max_tokens=600).strip()

    prompt = f"""Generate exactly {num_questions} high-quality exam questions (mix of MCQ and short answer) using this document and analysis.

CONCEPTUAL ANALYSIS:
{analysis}

DOCUMENT:
{text[:8000]}

Rules:
- MCQ: plausible distractors based on misconceptions, NEVER "all/none of the above"
- Short: require reasoned 2-3 sentence answers, not one-word recall
- Cover different concepts — no repetition
- Mix difficulty levels

Return ONLY a valid JSON array. Each object must have:
- "type": "mcq" or "short"
- "question": question text
- "options": array of 4 strings (mcq only)
- "answer": correct answer string
- "model_answer": 2-3 sentence model answer explaining the concept fully
- "topic": specific concept tested
- "difficulty": "easy", "medium", or "hard"

Return only the JSON array, no other text."""

    try:
        questions = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=4000))
        config = {
            'marks_each':        marks_each,
            'negative_marking':  negative_marking,
            'negative_fraction': negative_fraction,
            'duration_minutes':  duration_minutes,
            'total_marks':       len(questions) * marks_each,
        }
        return jsonify({'questions': questions, 'config': config}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI returned malformed JSON. Please try again.'}), 500
    except Exception as e:
        logger.error(f"Mock test error: {e}")
        return jsonify({'error': 'Failed to generate mock test'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Mock Paper (section pattern builder)
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/mock-paper/analyse-pattern', methods=['POST'])
@token_required
def analyse_paper_pattern(pdf_id):
    """Upload an exam pattern file (PDF/text/image) → extract section structure."""
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    f    = request.files['file']
    name = (f.filename or '').lower()
    mime = f.mimetype or ''

    json_schema = """{
  "title_hint": "paper title or exam name if found, else empty string",
  "duration_minutes": <integer or 0 if not found>,
  "total_marks": <integer or 0 if not found>,
  "pattern_summary": "1-2 sentence plain-English description of the paper pattern",
  "sections": [{"name": "Section A", "type": "mcq", "count": 10, "marks_each": 1}]
}"""

    extract_prompt = (
        "Analyse this exam pattern / question paper and extract its structure.\n"
        "Return ONLY a valid JSON object:\n" + json_schema + "\n"
        "sections[].type must be one of: mcq, multi_mcq, true_false, fill_blank, short, long\n"
        "Return only the JSON object, no other text."
    )

    is_image = mime.startswith('image/') or name.endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'))

    try:
        if is_image:
            import base64
            img_bytes = f.read()
            b64 = base64.b64encode(img_bytes).decode('utf-8')
            ext = name.rsplit('.', 1)[-1] if '.' in name else 'jpeg'
            data_url = f"data:image/{ext};base64,{b64}"
            messages = [{
                'role': 'user',
                'content': [
                    {'type': 'image_url', 'image_url': {'url': data_url}},
                    {'type': 'text', 'text': extract_prompt},
                ]
            }]
            model = 'meta-llama/llama-4-scout-17b-16e-instruct'
        else:
            pattern_text = ''
            if name.endswith('.pdf'):
                import fitz
                doc = fitz.open(stream=f.read(), filetype='pdf')
                pattern_text = '\n'.join(page.get_text() for page in doc).strip()
                doc.close()
            else:
                pattern_text = f.read().decode('utf-8', errors='ignore').strip()
            if not pattern_text:
                return jsonify({'error': 'File appears to be empty or unreadable.'}), 400
            messages = [{'role': 'user', 'content': f"Pattern document:\n{pattern_text[:6000]}\n\n{extract_prompt}"}]
            model = 'llama-3.3-70b-versatile'

        extracted = _parse_json_response(_groq_complete(messages, max_tokens=1500, model=model))
        return jsonify({'extracted': extracted}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI could not parse the pattern. Try a clearer image or PDF.'}), 500
    except Exception as e:
        logger.error(f"Pattern analyse error: {e}")
        return jsonify({'error': 'Failed to analyse pattern'}), 500


@ai_bp.route('/pdf/<pdf_id>/mock-paper/generate', methods=['POST'])
@token_required
def generate_mock_paper(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data             = request.get_json(force=True, silent=True) or {}
    title            = data.get('title', 'Question Paper')
    duration_minutes = int(data.get('duration_minutes', 180))
    sections         = data.get('sections', [
        {'name': 'Section A', 'type': 'mcq',   'count': 10, 'marks_each': 1},
        {'name': 'Section B', 'type': 'short',  'count': 5,  'marks_each': 4},
    ])

    text = _get_all_text(pdf_id, max_chars=10000)
    if not text:
        return jsonify({'error': 'PDF not yet indexed.'}), 400

    sections_desc = '\n'.join(
        f"- {s['name']}: {s['count']} {s['type']} questions, {s['marks_each']} mark(s) each"
        for s in sections
    )
    total_marks = sum(s['count'] * s['marks_each'] for s in sections)

    prompt = f"""Generate a complete question paper with the following structure:

Title: {title}
Duration: {duration_minutes} minutes
Total Marks: {total_marks}

Sections:
{sections_desc}

Return ONLY a valid JSON object:
{{
  "title": "{title}",
  "duration_minutes": {duration_minutes},
  "total_marks": {total_marks},
  "instructions": "General instructions string (2-3 sentences)",
  "sections": [
    {{
      "name": "section name",
      "instructions": "section-specific instruction",
      "marks_each": <integer>,
      "questions": [
        {{
          "number": 1,
          "type": "mcq or short or long or fill_blank or true_false",
          "question": "question text",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "answer": "correct answer",
          "model_answer": "model answer / marking guide"
        }}
      ]
    }}
  ]
}}

Source content:
{text}

Generate questions that cover the full breadth of the document.
Return only the JSON object, no other text."""

    try:
        paper = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=5000))
        return jsonify({'paper': paper}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI returned malformed JSON. Please try again.'}), 500
    except Exception as e:
        logger.error(f"Mock paper error: {e}")
        return jsonify({'error': 'Failed to generate mock paper'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Study Planner
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/study-planner', methods=['POST'])
@token_required
def study_planner(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    data          = request.get_json(force=True, silent=True) or {}
    exam_date     = data.get('exam_date', '').strip()
    hours_per_day = max(0.5, float(data.get('hours_per_day', 2)))
    start_date    = data.get('start_date', '').strip()
    weak_topics   = data.get('focus_topics') or data.get('weak_topics') or []

    if not exam_date:
        return jsonify({'error': 'exam_date required (YYYY-MM-DD)'}), 400

    today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    try:
        from datetime import date as _date
        exam_d  = _date.fromisoformat(exam_date)
        start_d = _date.fromisoformat(start_date) if start_date else _date.fromisoformat(today_str)
        today_d = _date.fromisoformat(today_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD.'}), 400

    if exam_d <= today_d:
        return jsonify({'error': 'Exam date must be in the future (at least tomorrow)'}), 400

    days_between = (exam_d - start_d).days
    if days_between < 1:
        days_between = 1

    # Use RAG to find topic overview
    results = _rag_search(pdf_id, 'topics chapters syllabus overview introduction', n=8)
    chunks  = results['documents'][0] if results.get('documents') else []
    context = '\n\n'.join(chunks) if chunks else _get_all_text(pdf_id, max_chars=6000)

    if not context:
        return jsonify({'error': 'PDF not yet indexed.'}), 400

    weak_str = f"\nWeak areas to prioritise: {', '.join(weak_topics)}" if weak_topics else ''
    prompt = f"""Create a day-by-day study plan for an upcoming exam.

Exam Date: {exam_date}
Start Date: {start_d.isoformat()}
Total Study Days Available: {days_between} days
Study Hours Per Day: {hours_per_day} hours{weak_str}

Based on the following course content, identify all major topics and allocate study time:
{context}

Return ONLY a valid JSON object:
{{
  "subject_overview": "2-sentence summary of what needs to be covered",
  "total_days": {days_between},
  "days": [
    {{
      "day": 1,
      "date_label": "Day 1 — Topic Name",
      "focus_topic": "Main topic for the day",
      "tasks": [
        {{"task": "Read and annotate Chapter 2 (section 2.1-2.3)", "hours": 1.0}},
        {{"task": "Solve 10 practice problems on topic X", "hours": 0.5}}
      ],
      "tip": "One concise study tip for today's material"
    }}
  ],
  "revision_strategy": "Brief advice on final week revision"
}}

Prioritise weak areas. Build from fundamentals to advanced. Include revision days near the exam.
Return only the JSON object, no other text."""

    try:
        plan = _parse_json_response(_groq_complete(
            [{'role': 'user', 'content': prompt}], max_tokens=4000))
        return jsonify({'plan': plan}), 200
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except json.JSONDecodeError:
        return jsonify({'error': 'AI returned malformed JSON. Please try again.'}), 500
    except Exception as e:
        logger.error(f"Study planner error: {e}")
        return jsonify({'error': 'Failed to generate study plan'}), 500


# ══════════════════════════════════════════════════════════════════════════════
# Performance Analytics
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/performance', methods=['GET'])
@token_required
def get_performance(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    results = list(db.quiz_results.find(
        {'pdf_id': pdf_id, 'user_id': user_id},
        {'_id': 0, 'score': 1, 'total': 1, 'weak_topics': 1, 'created_at': 1},
    ).sort('created_at', 1).limit(20))

    if not results:
        return jsonify({'results': [], 'summary': None}), 200

    trend = [
        {
            'label': r['created_at'].strftime('%d %b') if r.get('created_at') else '',
            'pct':   round((r['score'] / r['total']) * 100) if r.get('total') else 0,
        }
        for r in results
    ]

    all_weak  = [t for r in results for t in (r.get('weak_topics') or [])]
    from collections import Counter
    weak_topics = [t for t, _ in Counter(all_weak).most_common(8)]

    avg_pct    = round(sum(t['pct'] for t in trend) / len(trend)) if trend else 0
    latest_pct = trend[-1]['pct'] if trend else 0
    first_pct  = trend[0]['pct']  if trend else 0
    improvement = (latest_pct - first_pct) if len(trend) > 1 else None

    for r in results:
        if r.get('created_at'):
            r['created_at'] = r['created_at'].isoformat()

    return jsonify({
        'results':     results,
        'trend':       trend,
        'weak_topics': weak_topics,
        'summary': {
            'total_quizzes': len(results),
            'avg_score_pct': avg_pct,
            'latest_pct':    latest_pct,
            'improvement':   improvement,
        },
    }), 200


# ══════════════════════════════════════════════════════════════════════════════
# RAG Metrics (retrieval quality evaluation)
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/pdf/<pdf_id>/rag-metrics', methods=['GET'])
@token_required
def get_rag_metrics(pdf_id):
    from database import get_db
    user_id = request.user['user_id']
    db      = get_db()
    try:
        _check_pdf_access(db, pdf_id, user_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

    records = list(db.ai_rag_metrics.find(
        {'pdf_id': pdf_id},
        {'_id': 0, 'chunks_retrieved': 1, 'latency_ms': 1, 'ts': 1},
    ).sort('ts', -1).limit(200))

    if not records:
        return jsonify({'metrics': [], 'summary': {}}), 200

    latencies   = [r['latency_ms'] for r in records]
    retrievals  = [r['chunks_retrieved'] for r in records]
    success_pct = round(sum(1 for c in retrievals if c > 0) / len(retrievals) * 100, 1)
    sorted_lat  = sorted(latencies)
    p95_idx     = max(0, int(len(sorted_lat) * 0.95) - 1)

    summary = {
        'total_queries':         len(records),
        'avg_latency_ms':        round(sum(latencies) / len(latencies), 1),
        'p95_latency_ms':        round(sorted_lat[p95_idx], 1),
        'avg_chunks_retrieved':  round(sum(retrievals) / len(retrievals), 1),
        'retrieval_success_pct': success_pct,
    }

    for r in records:
        if r.get('ts'):
            r['ts'] = r['ts'].isoformat()

    return jsonify({'metrics': records, 'summary': summary}), 200


# ══════════════════════════════════════════════════════════════════════════════
# Chat Summariser (semester-level, kept separate)
# ══════════════════════════════════════════════════════════════════════════════

@ai_bp.route('/semester/<semester_id>/chat-summarise', methods=['POST'])
@token_required
def chat_summarise(semester_id):
    from database import get_db
    from utils.encryption import decrypt_text
    try:
        user_id = request.user['user_id']
        db      = get_db()

        semester  = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        data    = request.get_json(force=True, silent=True) or {}
        last_n  = int(data.get('last_n', 100))
        date_from = data.get('date_from')
        date_to   = data.get('date_to')

        query: dict = {'semester_id': semester_id, 'deleted_for_everyone': {'$ne': True}}
        if date_from:
            from datetime import datetime as _dt
            query.setdefault('created_at', {})['$gte'] = _dt.fromisoformat(date_from.replace('Z', '+00:00'))
        if date_to:
            from datetime import datetime as _dt
            query.setdefault('created_at', {})['$lte'] = _dt.fromisoformat(date_to.replace('Z', '+00:00'))

        msgs = list(
            db.chat_messages.find(query, {'text': 1, 'username': 1, 'full_name': 1, 'created_at': 1})
            .sort('created_at', -1).limit(last_n)
        )
        msgs.reverse()

        if not msgs:
            return jsonify({'error': 'No messages found in the specified range.'}), 404

        lines = []
        for m in msgs:
            name = m.get('full_name') or m.get('username', 'User')
            text = decrypt_text(m.get('text')) or ''
            if text:
                lines.append(f"{name}: {text}")

        if not lines:
            return jsonify({'error': 'No text messages found to summarise.'}), 404

        chat_text = '\n'.join(lines)
        if len(chat_text) > 12000:
            chat_text = chat_text[-12000:]

        prompt = (
            "You are summarising a classroom group chat.\n"
            "Produce a structured summary with:\n"
            "1. **Overview** — what was discussed (2-3 sentences)\n"
            "2. **Key Topics** — bulleted list of main discussion points\n"
            "3. **Action Items / Decisions** — any announcements, deadlines, or decisions made\n"
            "4. **Questions Raised** — any unresolved questions from students\n\n"
            f"Chat log ({len(lines)} messages):\n\n{chat_text}"
        )
        summary = _groq_complete([{'role': 'user', 'content': prompt}], max_tokens=1200)
        return jsonify({'summary': summary, 'message_count': len(lines)}), 200

    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503
    except Exception as e:
        logger.error(f"Chat summarise error: {e}")
        return jsonify({'error': 'Failed to summarise chat'}), 500
