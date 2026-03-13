"""Groq Vision utility for extracting timetable data from images/PDFs."""
import json
import os
import base64
import logging
from typing import Optional

logger = logging.getLogger(__name__)

VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'


def _get_groq_client():
    from groq import Groq
    api_key = os.getenv('GROQ_API_KEY')
    if not api_key:
        raise ValueError("GROQ_API_KEY environment variable not set")
    return Groq(api_key=api_key)


TIMETABLE_PROMPT = """
You are a timetable extraction assistant. Extract the college timetable from the image into this EXACT JSON structure:

{
  "days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "time_slots": ["8:00-9:00", "9:00-10:00", "10:00-11:00", "11:00-12:00", "12:00-1:00", "1:00-2:00", "2:00-3:00", "3:00-4:00"],
  "grid": {
    "Mon": {
      "8:00-9:00":  {"subject": "Engineering Mathematics", "teacher": "Dr. Smith", "room": "A101", "type": "Lecture"},
      "9:00-10:00": {"subject": "Physics Lab",             "teacher": "Dr. Roy",   "room": "Lab1", "type": "Lab"},
      "10:00-11:00":{"subject": "Physics Lab",             "teacher": "Dr. Roy",   "room": "Lab1", "type": "Lab"},
      "11:00-12:00":{"subject": "",                        "teacher": "",          "room": "",     "type": "Lunch"},
      "12:00-1:00": {"subject": "",                        "teacher": "",          "room": "",     "type": "Free"}
    }
  }
}

STRICT RULES — follow every one:
1. days: Include ONLY days visible in the image. Normalize: Monday→Mon, Tuesday→Tue, Wednesday→Wed, Thursday→Thu, Friday→Fri, Saturday→Sat.
2. time_slots: List EVERY individual hour slot exactly as shown in the image. Do NOT combine multi-hour slots.
3. type: Use exactly one of: "Lecture", "Lab", "Tutorial", "Free", "Lunch", "Break", "Library". Match what the image shows.
4. subject: Copy text EXACTLY as it appears in the image. Do not expand abbreviations, translate, or reformat.
5. teacher/room: Copy text exactly. Use "" if not shown.
6. Empty cells: {"subject": "", "teacher": "", "room": "", "type": "Free"}
7. CRITICAL — Multi-hour Labs/Practicals: When a lab or practical spans 2 or 3 consecutive time slots (shown as a merged/tall cell in the image), you MUST output the IDENTICAL subject+teacher+room+type entry in EVERY one of those individual time slots. Example: a 2-hour lab in 9:00-10:00 and 10:00-11:00 → put the SAME lab entry in BOTH slots. This is essential for correct display.
8. Return ONLY raw JSON. No markdown fences, no explanation, no extra text.
"""


def extract_timetable_from_image(image_data: bytes, mime_type: str = 'image/jpeg') -> dict:
    """
    Extract timetable structure from an image using Groq Vision.

    Returns:
        {'success': True, 'data': {...timetable...}}
        or
        {'success': False, 'error': '...message...'}
    """
    try:
        client = _get_groq_client()

        b64_image = base64.b64encode(image_data).decode('utf-8')

        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{b64_image}"
                            }
                        },
                        {
                            "type": "text",
                            "text": TIMETABLE_PROMPT
                        }
                    ]
                }
            ],
            temperature=0,
            max_tokens=4096,
        )

        result_text = response.choices[0].message.content.strip()

        # Strip markdown code blocks if model wraps in them
        if result_text.startswith('```'):
            parts = result_text.split('```')
            if len(parts) >= 3:
                result_text = parts[1]
                if result_text.startswith('json'):
                    result_text = result_text[4:]
        result_text = result_text.strip()

        data = json.loads(result_text)

        # Validate required top-level keys
        for key in ('days', 'time_slots', 'grid'):
            if key not in data:
                raise ValueError(f"Missing required field: '{key}' in extracted timetable")

        # Ensure each day in grid has all time slots
        for day in data['days']:
            if day not in data['grid']:
                data['grid'][day] = {}
            for slot in data['time_slots']:
                if slot not in data['grid'][day]:
                    data['grid'][day][slot] = {'subject': '', 'teacher': '', 'room': '', 'type': 'Free'}

        return {'success': True, 'data': data}

    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error in timetable extraction: {e}")
        return {
            'success': False,
            'error': 'Could not parse timetable structure from image. Try a clearer or higher-resolution image.'
        }
    except ValueError as e:
        logger.error(f"Validation error in timetable extraction: {e}")
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f"Timetable extraction error: {e}")
        return {'success': False, 'error': f'Extraction failed: {str(e)}'}


ACADEMIC_CALENDAR_PROMPT = """
You are an academic calendar extraction assistant for a college scheduling system.
Analyze this academic calendar image/document and extract ALL important dates into this exact JSON structure:

{
  "semester_start": "2024-07-01",
  "semester_end": "2024-11-30",
  "events": [
    {
      "date": "2024-08-15",
      "end_date": "2024-08-15",
      "title": "Independence Day",
      "type": "Holiday",
      "description": ""
    }
  ]
}

Rules:
- Use ISO date format YYYY-MM-DD for all dates
- For multi-day events (e.g., exam week), use end_date; for single-day events set end_date same as date
- Types: "Holiday", "Exam", "Event", "Break", "Submission", "Other"
- Include semester_start and semester_end dates if visible; use null if not found
- Return ONLY valid JSON, no markdown, no explanation
"""


def extract_academic_calendar_from_image(image_data: bytes, mime_type: str = 'image/jpeg') -> dict:
    """Extract academic calendar events from an image using Groq Vision."""
    try:
        client = _get_groq_client()

        b64_image = base64.b64encode(image_data).decode('utf-8')

        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{b64_image}"
                            }
                        },
                        {
                            "type": "text",
                            "text": ACADEMIC_CALENDAR_PROMPT
                        }
                    ]
                }
            ],
            temperature=0,
            max_tokens=4096,
        )

        result_text = response.choices[0].message.content.strip()
        if result_text.startswith('```'):
            parts = result_text.split('```')
            if len(parts) >= 3:
                result_text = parts[1]
                if result_text.startswith('json'):
                    result_text = result_text[4:]
        result_text = result_text.strip()

        data = json.loads(result_text)

        if 'events' not in data:
            data['events'] = []
        if 'semester_start' not in data:
            data['semester_start'] = None
        if 'semester_end' not in data:
            data['semester_end'] = None

        return {'success': True, 'data': data}

    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error in academic calendar extraction: {e}")
        return {
            'success': False,
            'error': 'Could not parse calendar structure from image. Try a clearer image.'
        }
    except Exception as e:
        logger.error(f"Academic calendar extraction error: {e}")
        return {'success': False, 'error': f'Extraction failed: {str(e)}'}
