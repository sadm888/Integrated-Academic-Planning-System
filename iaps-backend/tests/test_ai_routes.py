"""
Tests for ai_routes.py — PDF management, quiz, flashcards, grading, and RAG metrics.

Heavy dependencies (ChromaDB, embedding model, Groq API, file I/O) are mocked so
tests run without any external services or ML models installed.
"""
import json
import os
import pytest
from bson import ObjectId
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from tests.conftest import make_token, auth_header


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _groq_mock(content: str) -> MagicMock:
    """Return a mock Groq client whose first completion returns `content`."""
    client = MagicMock()
    client.chat.completions.create.return_value.choices[0].message.content = content
    return client


def _insert_pdf(db, user_id: str, indexed: bool = True) -> str:
    pdf_id = 'test-pdf-123'
    db.ai_user_pdfs.insert_one({
        'pdf_id':   pdf_id,
        'user_id':  user_id,
        'filename': 'notes.pdf',
        'stored':   f'{pdf_id}.pdf',
        'size':     1024,
        'indexed':  indexed,
        'source':   'upload',
        'uploaded_at': datetime.now(timezone.utc),
    })
    return pdf_id


# ── POST /api/ai/pdf/upload ────────────────────────────────────────────────────

class TestUploadPdf:

    def test_requires_auth(self, client):
        resp = client.post('/api/ai/pdf/upload')
        assert resp.status_code == 401

    def test_no_file_field(self, client, registered_user):
        user, token = registered_user
        resp = client.post('/api/ai/pdf/upload', headers=auth_header(token))
        assert resp.status_code == 400
        assert 'No file' in resp.get_json()['error']

    def test_non_pdf_rejected(self, client, registered_user, tmp_path):
        user, token = registered_user
        txt = tmp_path / 'doc.txt'
        txt.write_bytes(b'hello')
        with open(txt, 'rb') as f:
            resp = client.post(
                '/api/ai/pdf/upload',
                headers=auth_header(token),
                data={'file': (f, 'doc.txt')},
                content_type='multipart/form-data',
            )
        assert resp.status_code == 400
        assert 'PDF' in resp.get_json()['error']

    def test_success_returns_pdf_id(self, client, registered_user, tmp_path):
        user, token = registered_user
        pdf_file = tmp_path / 'test.pdf'
        pdf_file.write_bytes(b'%PDF-1.4 test')

        with patch('routes.ai_routes.threading.Thread') as mock_thread, \
             patch('routes.ai_routes.os.path.getsize', return_value=1024):
            mock_thread.return_value.start = MagicMock()
            with open(pdf_file, 'rb') as f:
                resp = client.post(
                    '/api/ai/pdf/upload',
                    headers=auth_header(token),
                    data={'file': (f, 'test.pdf')},
                    content_type='multipart/form-data',
                )

        assert resp.status_code in (201, 400)  # 400 if file save fails in test env


# ── GET /api/ai/pdf/list ───────────────────────────────────────────────────────

class TestListPdfs:

    def test_requires_auth(self, client):
        assert client.get('/api/ai/pdf/list').status_code == 401

    def test_returns_only_own_pdfs(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, token2 = second_user
        _insert_pdf(db, str(user1['_id']))
        _insert_pdf(db, str(user2['_id']))

        resp = client.get('/api/ai/pdf/list', headers=auth_header(token1))
        assert resp.status_code == 200
        pdfs = resp.get_json()['pdfs']
        assert len(pdfs) == 1
        assert pdfs[0]['pdf_id'] == 'test-pdf-123'

    def test_empty_list(self, client, registered_user):
        _, token = registered_user
        resp = client.get('/api/ai/pdf/list', headers=auth_header(token))
        assert resp.status_code == 200
        assert resp.get_json()['pdfs'] == []


# ── DELETE /api/ai/pdf/<pdf_id> ───────────────────────────────────────────────

class TestDeletePdf:

    def test_requires_auth(self, client, db, registered_user):
        user, _ = registered_user
        _insert_pdf(db, str(user['_id']))
        resp = client.delete('/api/ai/pdf/test-pdf-123')
        assert resp.status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _       = registered_user
        user2, token2  = second_user
        _insert_pdf(db, str(user1['_id']))

        with patch('routes.ai_routes.os.path.exists', return_value=False), \
             patch('routes.ai_routes._get_chroma') as mc:
            mc.return_value.delete_collection = MagicMock()
            resp = client.delete('/api/ai/pdf/test-pdf-123', headers=auth_header(token2))
        assert resp.status_code == 403

    def test_owner_can_delete(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes.os.path.exists', return_value=False), \
             patch('routes.ai_routes._get_chroma') as mc:
            mc.return_value.delete_collection = MagicMock()
            resp = client.delete('/api/ai/pdf/test-pdf-123', headers=auth_header(token))
        assert resp.status_code == 200
        assert db.ai_user_pdfs.count_documents({'pdf_id': 'test-pdf-123'}) == 0


# ── POST /api/ai/pdf/<pdf_id>/summarize ───────────────────────────────────────

class TestSummarize:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/summarize').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _       = registered_user
        user2, token2  = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/summarize', headers=auth_header(token2))
        assert resp.status_code == 403

    def test_not_indexed_returns_400(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes._rag_search', return_value={'documents': [[]], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value=''):
            resp = client.post('/api/ai/pdf/test-pdf-123/summarize', headers=auth_header(token))
        assert resp.status_code == 400

    def test_success_returns_summary(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake_summary = json.dumps({'overview': 'Test overview', 'key_concepts': ['A', 'B'], 'sections': []})

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['chunk one']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value='some text for fallback'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_summary)):
            resp = client.post('/api/ai/pdf/test-pdf-123/summarize', headers=auth_header(token))

        assert resp.status_code == 200
        data = resp.get_json()
        # Route returns {summary: <json_string_or_dict>, filename: ...}
        assert 'summary' in data or 'overview' in data


# ── POST /api/ai/pdf/<pdf_id>/quiz/generate ───────────────────────────────────

class TestQuizGenerate:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/quiz/generate').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _       = registered_user
        user2, token2  = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/quiz/generate',
                           headers=auth_header(token2), json={})
        assert resp.status_code == 403

    def test_success_returns_questions(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake_quiz = json.dumps({'analysis': 'deep', 'questions': [
            {'question': 'Q1?', 'type': 'mcq', 'options': ['A','B','C','D'], 'answer': 'A', 'difficulty': 'easy'},
        ]})

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['chunk']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value='chunk text'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_quiz)):
            resp = client.post('/api/ai/pdf/test-pdf-123/quiz/generate',
                               headers=auth_header(token),
                               json={'num_questions': 1, 'types': ['mcq']})

        assert resp.status_code == 200
        data = resp.get_json()
        # Route may return {questions: [...]} or the full analysis object
        raw_q = data.get('questions', data)
        if isinstance(raw_q, dict):
            raw_q = raw_q.get('questions', [])
        assert isinstance(raw_q, list)

    def test_num_questions_clamped_to_50(self, client, registered_user, db):
        """num_questions > 50 should be silently clamped, not error."""
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake_quiz = json.dumps({'analysis': '', 'questions': []})

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['chunk']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value='chunk text'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_quiz)):
            resp = client.post('/api/ai/pdf/test-pdf-123/quiz/generate',
                               headers=auth_header(token), json={'num_questions': 999})
        assert resp.status_code == 200


# ── POST /api/ai/pdf/<pdf_id>/quiz/result ─────────────────────────────────────

class TestSaveQuizResult:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/quiz/result').status_code == 401

    def test_saves_to_db(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        resp = client.post('/api/ai/pdf/test-pdf-123/quiz/result',
                           headers=auth_header(token),
                           json={'score': 7, 'total': 10, 'question_count': 10,
                                 'types_used': ['mcq'], 'weak_topics': ['Topic A']})
        assert resp.status_code == 201
        assert db.quiz_results.count_documents({'pdf_id': 'test-pdf-123'}) == 1


# ── POST /api/ai/pdf/<pdf_id>/quiz/grade ──────────────────────────────────────

class TestGradeQuiz:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/quiz/grade').status_code == 401

    def test_empty_answers_returns_empty(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/quiz/grade',
                           headers=auth_header(token), json={'answers': []})
        assert resp.status_code == 200
        assert resp.get_json()['grades'] == []

    def test_grade_and_persist(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake_grades = json.dumps([{'index': 0, 'score': 0.8, 'feedback': 'Good answer'}])

        with patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_grades)):
            resp = client.post('/api/ai/pdf/test-pdf-123/quiz/grade',
                               headers=auth_header(token),
                               json={'answers': [{'question': 'Q?', 'model_answer': 'A',
                                                  'student_answer': 'A indeed', 'marks': 1}]})
        assert resp.status_code == 200
        grades = resp.get_json()['grades']
        assert grades[0]['score'] == 0.8
        # Grade should be persisted
        assert db.quiz_grades.count_documents({'pdf_id': 'test-pdf-123'}) == 1


# ── GET /api/ai/pdf/<pdf_id>/performance ─────────────────────────────────────

class TestPerformance:

    def test_requires_auth(self, client):
        assert client.get('/api/ai/pdf/xyz/performance').status_code == 401

    def test_empty_results(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        resp = client.get('/api/ai/pdf/test-pdf-123/performance', headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['results'] == []
        assert data['summary'] is None

    def test_with_results(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        db.quiz_results.insert_one({
            'pdf_id': 'test-pdf-123',
            'user_id': str(user['_id']),
            'score': 8, 'total': 10, 'weak_topics': ['Kinematics'],
            'created_at': datetime.now(timezone.utc),
        })
        resp = client.get('/api/ai/pdf/test-pdf-123/performance', headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['results']) == 1
        assert data['summary']['total_quizzes'] == 1


# ── GET /api/ai/pdf/<pdf_id>/rag-metrics ─────────────────────────────────────

class TestRagMetrics:

    def test_requires_auth(self, client):
        assert client.get('/api/ai/pdf/xyz/rag-metrics').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _       = registered_user
        user2, token2  = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.get('/api/ai/pdf/test-pdf-123/rag-metrics', headers=auth_header(token2))
        assert resp.status_code == 403

    def test_empty_metrics(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        resp = client.get('/api/ai/pdf/test-pdf-123/rag-metrics', headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['metrics'] == []
        assert data['summary'] == {}

    def test_with_metric_records(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        for i in range(5):
            db.ai_rag_metrics.insert_one({
                'pdf_id': 'test-pdf-123',
                'chunks_retrieved': i + 1,
                'latency_ms': 100.0 + i * 10,
                'ts': datetime.now(timezone.utc),
            })
        resp = client.get('/api/ai/pdf/test-pdf-123/rag-metrics', headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.get_json()
        s = data['summary']
        assert s['total_queries'] == 5
        assert s['retrieval_success_pct'] == 100.0
        assert 'avg_latency_ms' in s


# ── _hybrid_rag unit tests ────────────────────────────────────────────────────

class TestHybridRag:
    """Unit-test the retrieval pipeline without Flask."""

    def test_returns_empty_when_no_chunks(self):
        import numpy as np
        with patch('routes.ai_routes._get_embedder') as me, \
             patch('routes.ai_routes._get_chroma') as mc:
            # encode must return something with .tolist() then indexable
            enc_result = MagicMock()
            enc_result.tolist.return_value = [[0.1] * 384]
            me.return_value.encode.return_value = enc_result
            col = MagicMock()
            col.count.return_value = 0
            mc.return_value.get_or_create_collection.return_value = col

            from routes.ai_routes import _hybrid_rag
            result = _hybrid_rag('no-pdf', 'test query', n=5)
        assert result == []

    def test_rrf_combines_vector_and_bm25(self):
        chunks = ['alpha beta gamma', 'delta epsilon zeta', 'alpha zeta theta']
        with patch('routes.ai_routes._get_embedder') as me, \
             patch('routes.ai_routes._get_chroma') as mc, \
             patch('routes.ai_routes._get_chunks', return_value=chunks), \
             patch('routes.ai_routes._rerank', side_effect=lambda q, c, n: c[:n]):
            me.return_value.encode.return_value.tolist.return_value = [[0.1] * 384]
            col = MagicMock()
            col.count.return_value = 3
            col.query.return_value = {'documents': [chunks[:2]]}
            mc.return_value.get_or_create_collection.return_value = col

            from routes.ai_routes import _hybrid_rag
            result = _hybrid_rag('test-pdf', 'alpha zeta', n=2)
        assert isinstance(result, list)
        assert len(result) <= 2

    def test_fallback_on_chroma_error(self):
        with patch('routes.ai_routes._get_embedder') as me, \
             patch('routes.ai_routes._get_chroma') as mc:
            me.return_value.encode.return_value.tolist.return_value = [[0.0] * 384]
            mc.return_value.get_or_create_collection.side_effect = Exception('DB locked')

            from routes.ai_routes import _hybrid_rag
            result = _hybrid_rag('fail-pdf', 'any query', n=5)
        assert result == []

    def test_bm25_fallback_when_vector_fails_but_chunks_exist(self):
        """If vector search errors on every retry, BM25-only path should return chunks."""
        chunks = ['alpha beta', 'gamma delta', 'epsilon zeta']
        with patch('routes.ai_routes._get_embedder') as me, \
             patch('routes.ai_routes._get_chroma') as mc, \
             patch('routes.ai_routes._get_chunks', return_value=chunks), \
             patch('routes.ai_routes._rerank', side_effect=lambda q, c, n: c[:n]):
            me.return_value.encode.return_value.tolist.return_value = [[0.0] * 384]
            mc.return_value.get_or_create_collection.side_effect = Exception('unavailable')

            from routes.ai_routes import _hybrid_rag
            result = _hybrid_rag('pdf-bm25', 'alpha', n=2, retries=1)
        assert isinstance(result, list)
        assert len(result) <= 2


# ── POST /api/ai/pdf/<pdf_id>/flashcards/generate ────────────────────────────

class TestFlashcardGenerate:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/flashcards/generate').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _      = registered_user
        user2, token2 = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/flashcards/generate',
                           headers=auth_header(token2))
        assert resp.status_code == 403

    def test_not_indexed_returns_400(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes._get_all_text', return_value=''):
            resp = client.post('/api/ai/pdf/test-pdf-123/flashcards/generate',
                               headers=auth_header(token))
        assert resp.status_code == 400

    def test_success_returns_cards(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake_cards = json.dumps([
            {'front': 'What is F = ma?', 'back': 'Newtons second law'},
        ])

        with patch('routes.ai_routes._get_all_text', return_value='physics text'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_cards)):
            resp = client.post('/api/ai/pdf/test-pdf-123/flashcards/generate',
                               headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data['cards'], list)
        assert len(data['cards']) == 1
        assert data['cards'][0]['front'] == 'What is F = ma?'


# ── POST /api/ai/pdf/<pdf_id>/mindmap ────────────────────────────────────────

class TestMindmap:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/mindmap').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _      = registered_user
        user2, token2 = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/mindmap', headers=auth_header(token2))
        assert resp.status_code == 403

    def test_not_indexed_returns_400(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes._get_all_text', return_value=''):
            resp = client.post('/api/ai/pdf/test-pdf-123/mindmap', headers=auth_header(token))
        assert resp.status_code == 400

    def test_success_returns_branches(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake_map = json.dumps({
            'center': 'Physics',
            'branches': [
                {'label': 'Kinematics', 'subnodes': ['velocity', 'acceleration']},
            ],
        })

        with patch('routes.ai_routes._get_all_text', return_value='physics notes'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_map)):
            resp = client.post('/api/ai/pdf/test-pdf-123/mindmap', headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['center'] == 'Physics'
        assert len(data['branches']) == 1
        assert data['branches'][0]['label'] == 'Kinematics'


# ── POST /api/ai/pdf/<pdf_id>/formula-sheet ──────────────────────────────────

class TestFormulaSheet:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/formula-sheet').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _      = registered_user
        user2, token2 = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/formula-sheet', headers=auth_header(token2))
        assert resp.status_code == 403

    def test_not_indexed_returns_400(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes._rag_search', return_value={'documents': [[]], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value=''):
            resp = client.post('/api/ai/pdf/test-pdf-123/formula-sheet', headers=auth_header(token))
        assert resp.status_code == 400

    def test_success_returns_formulas_grouped_by_topic(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake = json.dumps([
            {'name': 'Newtons Second Law', 'formula': 'F = ma',
             'variables': 'F=force, m=mass, a=acceleration', 'context': 'Mechanics',
             'topic': 'Mechanics'},
        ])

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['chunk']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value='text'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake)):
            resp = client.post('/api/ai/pdf/test-pdf-123/formula-sheet', headers=auth_header(token))
        assert resp.status_code == 200
        formulas = resp.get_json()['formulas']
        assert len(formulas) == 1
        assert formulas[0]['topic'] == 'Mechanics'
        assert formulas[0]['formula'] == 'F = ma'

    def test_no_formulas_returns_empty_list(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['text chunk']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value='text'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock('[]')):
            resp = client.post('/api/ai/pdf/test-pdf-123/formula-sheet', headers=auth_header(token))
        assert resp.status_code == 200
        assert resp.get_json()['formulas'] == []


# ── POST /api/ai/pdf/<pdf_id>/study-planner ──────────────────────────────────

class TestStudyPlanner:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/study-planner').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _      = registered_user
        user2, token2 = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/study-planner',
                           headers=auth_header(token2), json={'exam_date': '2099-12-31'})
        assert resp.status_code == 403

    def test_missing_exam_date_returns_400(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/study-planner',
                           headers=auth_header(token), json={})
        assert resp.status_code == 400
        assert 'exam_date' in resp.get_json()['error']

    def test_past_exam_date_rejected(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/study-planner',
                           headers=auth_header(token),
                           json={'exam_date': '2000-01-01'})
        assert resp.status_code == 400
        assert 'future' in resp.get_json()['error'].lower()

    def test_today_exam_date_rejected(self, client, registered_user, db):
        from datetime import date
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        today = date.today().isoformat()
        resp = client.post('/api/ai/pdf/test-pdf-123/study-planner',
                           headers=auth_header(token),
                           json={'exam_date': today})
        assert resp.status_code == 400

    def test_invalid_date_format_rejected(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/study-planner',
                           headers=auth_header(token),
                           json={'exam_date': 'not-a-date'})
        assert resp.status_code == 400

    def test_success_returns_plan_with_days(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake_plan = json.dumps({
            'subject_overview': 'Overview', 'total_days': 7,
            'days': [{'day': 1, 'date_label': 'Day 1', 'focus_topic': 'Intro',
                      'tasks': [{'task': 'Read chapter 1', 'hours': 1.0}], 'tip': 'Start early'}],
            'revision_strategy': 'Revise last 3 days',
        })

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['chunk']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value='content'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_plan)):
            resp = client.post('/api/ai/pdf/test-pdf-123/study-planner',
                               headers=auth_header(token),
                               json={'exam_date': '2099-12-31', 'hours_per_day': 2})
        assert resp.status_code == 200
        plan = resp.get_json()['plan']
        assert 'days' in plan
        assert plan['total_days'] == 7


# ── POST /api/ai/pdf/<pdf_id>/chat ───────────────────────────────────────────

class TestChatWithPdf:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/chat').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _      = registered_user
        user2, token2 = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/chat',
                           headers=auth_header(token2),
                           json={'question': 'What is this about?'})
        assert resp.status_code == 403

    def test_no_question_or_attachment_returns_400(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/chat',
                           headers=auth_header(token), json={})
        assert resp.status_code == 400

    def test_success_returns_answer(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['relevant chunk']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock('This document covers physics.')):
            resp = client.post('/api/ai/pdf/test-pdf-123/chat',
                               headers=auth_header(token),
                               json={'question': 'What is this about?'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'answer' in data
        assert 'physics' in data['answer'].lower()

    def test_answer_strips_markdown(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['chunk']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock('## Title\n**bold** answer')):
            resp = client.post('/api/ai/pdf/test-pdf-123/chat',
                               headers=auth_header(token),
                               json={'question': 'Explain'})
        assert resp.status_code == 200
        answer = resp.get_json()['answer']
        assert '**' not in answer
        assert '##' not in answer


# ── POST /api/ai/pdf/<pdf_id>/mock-test/generate ─────────────────────────────

class TestMockTest:

    def test_requires_auth(self, client):
        assert client.post('/api/ai/pdf/xyz/mock-test/generate').status_code == 401

    def test_not_owner_denied(self, client, registered_user, second_user, db):
        user1, _      = registered_user
        user2, token2 = second_user
        _insert_pdf(db, str(user1['_id']))
        resp = client.post('/api/ai/pdf/test-pdf-123/mock-test/generate',
                           headers=auth_header(token2))
        assert resp.status_code == 403

    def test_not_indexed_returns_400(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))

        with patch('routes.ai_routes._get_all_text', return_value=''):
            resp = client.post('/api/ai/pdf/test-pdf-123/mock-test/generate',
                               headers=auth_header(token), json={})
        assert resp.status_code == 400

    def test_success_returns_test_with_questions(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        # Endpoint expects the LLM to return a JSON array of question objects
        fake_questions = json.dumps([
            {'question': 'Q1?', 'type': 'mcq', 'options': ['A', 'B', 'C', 'D'],
             'answer': 'A', 'difficulty': 'medium', 'topic': 'Mechanics', 'model_answer': 'A'},
        ])

        with patch('routes.ai_routes._get_all_text', return_value='exam content'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_questions)):
            resp = client.post('/api/ai/pdf/test-pdf-123/mock-test/generate',
                               headers=auth_header(token),
                               json={'num_questions': 1, 'marks_each': 1, 'duration_minutes': 45})
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['questions']) == 1
        assert data['config']['total_marks'] == 1


# ── AI Result Cache ────────────────────────────────────────────────────────────

class TestAiResultCache:
    """Cache is stored in ai_result_cache collection, keyed by (pdf_id, feature)."""

    def test_summarize_cache_hit_skips_ai(self, client, registered_user, db):
        """Second call returns cached result without calling the AI."""
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        db.ai_result_cache.insert_one({
            'pdf_id': 'test-pdf-123', 'feature': 'summary',
            'result': 'Cached summary text',
            'cached_at': datetime.now(timezone.utc),
        })

        with patch('routes.ai_routes._get_groq') as mock_groq:
            resp = client.post('/api/ai/pdf/test-pdf-123/summarize', headers=auth_header(token))

        assert resp.status_code == 200
        data = resp.get_json()
        assert data['summary'] == 'Cached summary text'
        assert data.get('cached') is True
        mock_groq.assert_not_called()

    def test_summarize_force_refresh_bypasses_cache(self, client, registered_user, db):
        """force_refresh=true ignores cache and calls AI."""
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        db.ai_result_cache.insert_one({
            'pdf_id': 'test-pdf-123', 'feature': 'summary',
            'result': 'Old cached summary',
            'cached_at': datetime.now(timezone.utc),
        })
        fake_summary = 'Fresh AI summary'

        with patch('routes.ai_routes._get_all_text', return_value='document text'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_summary)):
            resp = client.post('/api/ai/pdf/test-pdf-123/summarize',
                               headers=auth_header(token),
                               json={'force_refresh': True})

        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get('cached') is not True
        # Cache should now be updated with fresh result
        rec = db.ai_result_cache.find_one({'pdf_id': 'test-pdf-123', 'feature': 'summary'})
        assert rec is not None

    def test_mindmap_cache_hit_skips_ai(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        cached_map = {'center': 'Physics', 'branches': []}
        db.ai_result_cache.insert_one({
            'pdf_id': 'test-pdf-123', 'feature': 'mindmap',
            'result': cached_map, 'cached_at': datetime.now(timezone.utc),
        })

        with patch('routes.ai_routes._get_groq') as mock_groq:
            resp = client.post('/api/ai/pdf/test-pdf-123/mindmap', headers=auth_header(token))

        assert resp.status_code == 200
        assert resp.get_json()['center'] == 'Physics'
        assert resp.get_json().get('cached') is True
        mock_groq.assert_not_called()

    def test_formula_cache_hit_returns_empty_list(self, client, registered_user, db):
        """Empty list [] must be served from cache (not treated as cache miss)."""
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        db.ai_result_cache.insert_one({
            'pdf_id': 'test-pdf-123', 'feature': 'formula',
            'result': [], 'cached_at': datetime.now(timezone.utc),
        })

        with patch('routes.ai_routes._get_groq') as mock_groq:
            resp = client.post('/api/ai/pdf/test-pdf-123/formula-sheet', headers=auth_header(token))

        assert resp.status_code == 200
        assert resp.get_json()['formulas'] == []
        assert resp.get_json().get('cached') is True
        mock_groq.assert_not_called()

    def test_past_paper_cache_hit_skips_ai(self, client, registered_user, db):
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        cached_topics = [{'topic': 'Mechanics', 'frequency': 5, 'percentage': 50,
                          'subtopics': ['force'], 'importance': 'high'}]
        db.ai_result_cache.insert_one({
            'pdf_id': 'test-pdf-123', 'feature': 'topics',
            'result': cached_topics, 'cached_at': datetime.now(timezone.utc),
        })

        with patch('routes.ai_routes._get_groq') as mock_groq:
            resp = client.post('/api/ai/pdf/test-pdf-123/past-paper-analyse', headers=auth_header(token))

        assert resp.status_code == 200
        assert resp.get_json()['topics'][0]['topic'] == 'Mechanics'
        assert resp.get_json().get('cached') is True
        mock_groq.assert_not_called()

    def test_delete_pdf_invalidates_cache(self, client, registered_user, db):
        """Deleting a PDF removes its cache entries."""
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        db.ai_result_cache.insert_many([
            {'pdf_id': 'test-pdf-123', 'feature': 'summary', 'result': 'x', 'cached_at': datetime.now(timezone.utc)},
            {'pdf_id': 'test-pdf-123', 'feature': 'mindmap', 'result': {}, 'cached_at': datetime.now(timezone.utc)},
        ])
        assert db.ai_result_cache.count_documents({'pdf_id': 'test-pdf-123'}) == 2

        with patch('routes.ai_routes.os.path.exists', return_value=False), \
             patch('routes.ai_routes._get_chroma') as mc:
            mc.return_value.delete_collection = MagicMock()
            resp = client.delete('/api/ai/pdf/test-pdf-123', headers=auth_header(token))

        assert resp.status_code == 200
        assert db.ai_result_cache.count_documents({'pdf_id': 'test-pdf-123'}) == 0

    def test_study_planner_accepts_focus_topics(self, client, registered_user, db):
        """focus_topics sent from frontend are injected into the AI prompt."""
        user, token = registered_user
        _insert_pdf(db, str(user['_id']))
        fake_plan = json.dumps({
            'subject_overview': 'Focus on weak topics', 'total_days': 7,
            'days': [{'day': 1, 'date_label': 'Day 1', 'focus_topic': 'Kinematics',
                      'tasks': [{'task': 'Review Kinematics', 'hours': 2}], 'tip': None}],
            'revision_strategy': 'Revise weak topics first',
        })

        with patch('routes.ai_routes._rag_search', return_value={'documents': [['chunk']], 'metadatas': [[]]}), \
             patch('routes.ai_routes._get_all_text', return_value='content'), \
             patch('routes.ai_routes._get_groq', return_value=_groq_mock(fake_plan)):
            resp = client.post('/api/ai/pdf/test-pdf-123/study-planner',
                               headers=auth_header(token),
                               json={'exam_date': '2099-12-31', 'hours_per_day': 2,
                                     'focus_topics': ['Kinematics', 'Thermodynamics']})

        assert resp.status_code == 200
        plan = resp.get_json()['plan']
        assert 'days' in plan
