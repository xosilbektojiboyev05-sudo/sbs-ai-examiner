import os

import re

import json

import base64

import tempfile

import math

from pathlib import Path

from typing import Any



from fastapi import FastAPI, HTTPException, UploadFile, File, Response

from fastapi.responses import FileResponse, JSONResponse

from pydantic import BaseModel

from groq import Groq





# ============================================================

# SBS AI EXAMINER

# IELTS Writing + Speaking AI Platform

# ============================================================





# ============================================================

# FILE CONFIGURATION

# ============================================================



BASE_DIR = Path(__file__).resolve().parent



INDEX_FILE = BASE_DIR / "index.html"

STYLE_FILE = BASE_DIR / "style.css"

SCRIPT_FILE = BASE_DIR / "script.js"

LOGO_FILE = BASE_DIR / "image.png"





# ============================================================

# AI MODELS

# ============================================================



WRITING_MODEL = "openai/gpt-oss-120b"

VISION_MODEL = "qwen/qwen3.8-27b"

SPEECH_MODEL = "whisper-large-v3"





# ============================================================

# FASTAPI APP

# ============================================================



app = FastAPI(

    title="SBS AI Examiner",

    description="AI-powered IELTS Writing and Speaking Examiner",

    version="4.0.0",

)





# ============================================================

# GROQ

# ============================================================



GROQ_API_KEY = os.getenv("GROQ_API_KEY")



if not GROQ_API_KEY:

    print(

        "WARNING: GROQ_API_KEY environment variable is not set."

    )



client = (

    Groq(api_key=GROQ_API_KEY)

    if GROQ_API_KEY

    else None

)





def require_client() -> Groq:

    if client is None:

        raise HTTPException(

            status_code=500,

            detail="GROQ_API_KEY is not configured."

        )



    return client





# ============================================================

# JSON HELPERS

# ============================================================



def clean_json_text(text: str) -> str:



    text = (text or "").strip()



    if text.startswith("```"):

        text = re.sub(

            r"^```(?:json)?\s*",

            "",

            text

        )



        text = re.sub(

            r"\s*```$",

            "",

            text

        )



    return text.strip()





def parse_ai_json(

    text: str

) -> dict[str, Any]:



    cleaned = clean_json_text(text)



    try:

        return json.loads(cleaned)



    except json.JSONDecodeError:



        match = re.search(

            r"\\{.*\\}",

            cleaned,

            re.DOTALL

        )



        if match:



            try:

                return json.loads(

                    match.group(0)

                )



            except json.JSONDecodeError:

                pass



        raise HTTPException(

            status_code=500,

            detail="AI returned invalid JSON."

        )





# ============================================================

# IELTS BAND HELPERS

# ============================================================



def clamp_band(value: Any) -> float:



    try:

        number = float(value)



    except (

        TypeError,

        ValueError

    ):

        number = 0.0



    number = max(

        0.0,

        min(9.0, number)

    )



    return math.floor(

        number * 2 + 0.5

    ) / 2





def calculate_ielts_overall(

    values: list[float]

) -> float:



    if not values:

        return 0.0



    average = sum(values) / len(values)



    return math.floor(

        average * 2 + 0.5

    ) / 2





def word_count(

    text: str

) -> int:



    return len(

        re.findall(

            r"\b[\w'-]+\b",

            text or ""

        )

    )





def normalize_list(

    value: Any

) -> list:



    if isinstance(value, list):

        return value



    if value is None:

        return []



    return [str(value)]





# ============================================================

# DATA MODELS

# ============================================================



class WritingRequest(BaseModel):



    task: str = "1"

    question: str = ""

    essay: str = ""

    language: str = "en"





class SpeakingAnswer(BaseModel):



    question: str

    answer: str

    part: int





class SpeakingEvaluationRequest(BaseModel):



    answers: list[SpeakingAnswer]





# ============================================================

# MAIN PAGE

# ============================================================



@app.get("/")

async def home():



    if not INDEX_FILE.exists():



        raise HTTPException(

            status_code=404,

            detail="index.html not found."

        )



    return FileResponse(

        INDEX_FILE

    )





# ============================================================

@app.head("/")
async def home_head():
    return Response(status_code=200)


# CSS

# ============================================================



@app.get("/style.css")

async def stylesheet():



    if not STYLE_FILE.exists():



        raise HTTPException(

            status_code=404,

            detail="style.css not found."

        )



    return FileResponse(

        STYLE_FILE,

        media_type="text/css"

    )





# ============================================================

# JAVASCRIPT

# ============================================================



@app.get("/script.js")

async def javascript():



    if not SCRIPT_FILE.exists():



        raise HTTPException(

            status_code=404,

            detail="script.js not found."

        )



    return FileResponse(

        SCRIPT_FILE,

        media_type="application/javascript"

    )





# ============================================================

# SBS LOGO

# ============================================================



@app.get("/image.png")

async def logo():



    if not LOGO_FILE.exists():



        raise HTTPException(

            status_code=404,

            detail="image.png not found."

        )



    return FileResponse(

        LOGO_FILE,

        media_type="image/png"

    )





# ============================================================

# HEALTH CHECK

# ============================================================



@app.get("/api/health")

async def health():



    return {

        "status": "ok",

        "service": "SBS AI Examiner",

        "groq_configured": bool(

            GROQ_API_KEY

        ),

        "models": {

            "writing": WRITING_MODEL,

            "vision": VISION_MODEL,

            "speech": SPEECH_MODEL,

        }

    }





# ============================================================

# IMAGE → DATA URL

# ============================================================



def image_to_data_url(

    image_bytes: bytes,

    content_type: str

) -> str:



    encoded = base64.b64encode(

        image_bytes

    ).decode("utf-8")



    return (

        f"data:{content_type};base64,{encoded}"

    )





# ============================================================

# VISION

# ============================================================



async def analyze_image(

    image: UploadFile,

    instruction: str

) -> str:



    groq = require_client()



    image_bytes = await image.read()



    if not image_bytes:



        raise HTTPException(

            status_code=400,

            detail="Uploaded image is empty."

        )



    content_type = (

        image.content_type

        or "image/jpeg"

    )



    if not content_type.startswith(

        "image/"

    ):



        raise HTTPException(

            status_code=400,

            detail="Only image files are supported."

        )



    if len(image_bytes) > (

        20 * 1024 * 1024

    ):



        raise HTTPException(

            status_code=400,

            detail="Image is too large. Maximum size is 20 MB."

        )



    data_url = image_to_data_url(

        image_bytes,

        content_type

    )



    response = (

        groq.chat.completions.create(

            model=VISION_MODEL,

            temperature=0,

            max_tokens=2500,

            messages=[

                {

                    "role": "user",

                    "content": [

                        {

                            "type": "text",

                            "text": instruction

                        },

                        {

                            "type": "image_url",

                            "image_url": {

                                "url": data_url

                            }

                        }

                    ]

                }

            ]

        )

    )



    return (

        response

        .choices[0]

        .message

        .content

        or ""

    )





# ============================================================

# WRITING EVALUATION

# ============================================================



@app.post("/api/assess-writing")

async def assess_writing(

    request: WritingRequest

):



    groq = require_client()



    task = request.task.strip()

    question = request.question.strip()

    essay = request.essay.strip()



    if not essay:



        raise HTTPException(

            status_code=400,

            detail="Writing answer is empty."

        )



    if not question:



        raise HTTPException(

            status_code=400,

            detail="Writing question is empty."

        )



    count = word_count(essay)



    if task == "1":



        task_description = (

            "IELTS Academic Writing Task 1"

        )



        minimum_words = 150

        first_criterion = (

            "Task Achievement"

        )



    else:



        task_description = (

            "IELTS Academic Writing Task 2"

        )



        minimum_words = 250

        first_criterion = (

            "Task Response"

        )





    prompt = f"""

You are a highly experienced IELTS Academic Writing examiner.



Assess the student's actual writing using IELTS-style band

descriptors.



TASK:

{task_description}



MINIMUM WORD COUNT:

{minimum_words}



CURRENT WORD COUNT:

{count}





IMPORTANT SCORING PRINCIPLES:



1\. Be strict, but do NOT artificially lower the score.



2\. Do not give Band 7 or lower merely because the answer contains

one or two minor mistakes.



3\. Evaluate the complete performance, not isolated mistakes.



4\. A strong Band 7, 7.5 or 8 response can contain occasional

grammar, vocabulary, punctuation or wording errors.



5\. Do not punish the student twice for the same mistake.



6\. A data-selection mistake in Task 1 should primarily affect

Task Achievement.



7\. Do not automatically lower Grammar or Lexical Resource because

of a data-selection mistake.



8\. A vocabulary mistake should primarily affect Lexical Resource.



9\. A grammar mistake should primarily affect Grammatical Range

and Accuracy.



10\. Coherence should be judged from the complete organization

and logical progression.



11\. Do not require every sentence to contain advanced vocabulary.



12\. Natural and precise vocabulary is better than unnecessary

complex vocabulary.



13\. Do not invent statistics or information.



14\. A minor wording problem does not automatically mean Band 6.



15\. Give Band 8 only when the performance genuinely demonstrates

strong control.



16\. Use only .0 and .5 scores.





BAND CALIBRATION:



Band 5:

\- limited control

\- frequent noticeable problems

\- inadequate development

\- vocabulary and grammar often restrict communication



Band 6:

\- generally relevant

\- generally understandable

\- adequate vocabulary

\- some complex structures

\- noticeable errors

\- communication remains generally clear



Band 7:

\- clear progression

\- good organization

\- sufficient vocabulary

\- generally controlled grammar

\- some errors remain

\- errors do not seriously reduce clarity



Band 7.5:

\- clearly stronger than typical Band 7

\- wide vocabulary

\- generally precise language

\- good grammatical control

\- occasional weaknesses

\- strong organization



Band 8:

\- very good control

\- wide and flexible vocabulary

\- wide range of structures

\- most sentences error-free

\- precise and well-developed response





TASK 1:



Assess:



\- overview

\- main features

\- comparisons

\- accurate data

\- grouping

\- trends



A small numerical imprecision should not automatically destroy

the entire Task Achievement score.



TASK 2:



Assess:



\- position

\- idea development

\- relevance

\- examples

\- logical progression

\- paragraphing

\- vocabulary

\- grammar





CRITERIA:



1\. {first_criterion}

2\. Coherence and Cohesion

3\. Lexical Resource

4\. Grammatical Range and Accuracy





SCORING METHOD:



First decide each criterion separately.



Then explain the evidence.



Then calculate the overall score.



Do not lower all four criteria because of one weakness.





RETURN ONLY VALID JSON:



{{

    "overall_band": 0.0,

    "task_score": 0.0,

    "coherence_score": 0.0,

    "lexical_score": 0.0,

    "grammar_score": 0.0,

    "word_count": {count},

    "word_count_warning": "",

    "summary": "",

    "strengths": [],

    "weaknesses": [],

    "grammar_corrections": [],

    "vocabulary_suggestions": [],

    "improved_plan": ""

}}





QUESTION:



{question}





STUDENT ANSWER:



{essay}

"""





    response = (

        groq.chat.completions.create(

            model=WRITING_MODEL,

            temperature=0.15,

            max_tokens=4000,

            messages=[

                {

                    "role": "system",

                    "content": (

                        "You are an evidence-based IELTS "

                        "Academic Writing examiner. "

                        "Score accurately according to "

                        "IELTS-style band descriptors. "

                        "Do not artificially lower scores. "

                        "Return valid JSON only."

                    )

                },

                {

                    "role": "user",

                    "content": prompt

                }

            ]

        )

    )





    result = parse_ai_json(

        response

        .choices[0]

        .message

        .content

        or ""

    )





    task_score = clamp_band(

        result.get("task_score")

    )



    coherence_score = clamp_band(

        result.get("coherence_score")

    )



    lexical_score = clamp_band(

        result.get("lexical_score")

    )



    grammar_score = clamp_band(

        result.get("grammar_score")

    )





    overall = calculate_ielts_overall([

        task_score,

        coherence_score,

        lexical_score,

        grammar_score

    ])





    result["task_score"] = task_score

    result["coherence_score"] = coherence_score

    result["lexical_score"] = lexical_score

    result["grammar_score"] = grammar_score

    result["overall_band"] = overall

    result["word_count"] = count





    result["strengths"] = normalize_list(

        result.get("strengths")

    )



    result["weaknesses"] = normalize_list(

        result.get("weaknesses")

    )



    result["grammar_corrections"] = normalize_list(

        result.get("grammar_corrections")

    )



    result["vocabulary_suggestions"] = normalize_list(

        result.get("vocabulary_suggestions")

    )





    if count < minimum_words:



        result["word_count_warning"] = (

            f"Your answer contains {count} words. "

            f"The recommended minimum is "

            f"{minimum_words} words."

        )



    else:



        result["word_count_warning"] = ""





    return result





# ============================================================

# IMAGE / HANDWRITING READER

# ============================================================



@app.post("/api/read-writing-image")

async def read_writing_image(

    image: UploadFile = File(...)

):



    instruction = """

You are an IELTS writing image/OCR assistant.



Read the IELTS writing question and/or handwritten student answer

visible in the image.



If there is a handwritten answer:



\- transcribe it accurately

\- preserve original wording

\- preserve grammar mistakes

\- do not correct the English

\- do not rewrite sentences



If there is a graph, chart, table, process or diagram:



\- read the IELTS question accurately

\- preserve visible numerical information

\- do not invent data



Return ONLY valid JSON:



{

    "question": "",

    "answer": "",

    "notes": ""

}

"""



    text = await analyze_image(

        image,

        instruction

    )



    return parse_ai_json(text)





# ============================================================

# SPEAKING TRANSCRIPTION

# ============================================================



@app.post("/api/speaking/transcribe")

async def transcribe_speaking_audio(

    audio: UploadFile = File(...)

):



    groq = require_client()



    audio_bytes = await audio.read()



    if not audio_bytes:



        raise HTTPException(

            status_code=400,

            detail="Audio file is empty."

        )



    suffix = Path(

        audio.filename

        or "recording.webm"

    ).suffix



    if not suffix:

        suffix = ".webm"



    temp_path = None



    try:



        with tempfile.NamedTemporaryFile(

            delete=False,

            suffix=suffix

        ) as temp_file:



            temp_file.write(

                audio_bytes

            )



            temp_path = temp_file.name





        with open(

            temp_path,

            "rb"

        ) as audio_file:



            transcription = (

                groq.audio.transcriptions.create(

                    file=audio_file,

                    model=SPEECH_MODEL,

                    response_format="verbose_json",

                    temperature=0

                )

            )





        text = getattr(

            transcription,

            "text",

            ""

        ) or ""





        return {

            "text": text.strip()

        }





    except Exception as exc:



        raise HTTPException(

            status_code=500,

            detail=(

                "Speech transcription failed: "

                f"{exc}"

            )

        )





    finally:



        if temp_path:



            try:

                os.remove(temp_path)



            except OSError:

                pass





# ============================================================

# SPEAKING EVALUATION

# ============================================================



@app.post("/api/speaking/evaluate")

async def evaluate_speaking(

    request: SpeakingEvaluationRequest

):



    groq = require_client()



    answers = request.answers





    # --------------------------------------------------------

    # REQUIRE 5 PART 1 ANSWERS

    # --------------------------------------------------------



    part1_answers = [

        item

        for item in answers

        if (

            item.part == 1

            and item.answer.strip()

        )

    ]





    if len(part1_answers) < 5:



        raise HTTPException(

            status_code=400,

            detail=(

                "Part 1 requires 5 recorded "

                "answers before evaluation. "

                f"Currently received: "

                f"{len(part1_answers)}."

            )

        )





    # --------------------------------------------------------

    # BUILD PERFORMANCE

    # --------------------------------------------------------



    answer_text = []



    for index, item in enumerate(

        answers,

        start=1

    ):



        answer_text.append(

            f"""

ANSWER {index}



PART:

{item.part}



QUESTION:

{item.question}



STUDENT RESPONSE:

{item.answer}

"""

        )





    combined_answers = "\n".join(

        answer_text

    )





    # --------------------------------------------------------

    # SPEAKING PROMPT

    # --------------------------------------------------------



    prompt = f"""

You are a highly experienced IELTS Speaking examiner.



Evaluate the student's actual IELTS Speaking performance.



The student has completed five Part 1 questions.



You must be strict about evidence, but fair about the actual

IELTS performance.



Do NOT artificially lower scores.



Do NOT give Band 4 unless the responses genuinely demonstrate

Band 4 characteristics.





# ============================================================

CRITERIA

# ============================================================



1\. Fluency and Coherence

2\. Lexical Resource

3\. Grammatical Range and Accuracy

4\. Pronunciation





# ============================================================

BAND 4

# ============================================================



Use Band 4 only when there are clear characteristics such as:



\- frequent hesitation

\- very short or incomplete answers

\- difficulty answering basic questions

\- very limited vocabulary

\- frequent grammar problems

\- communication is frequently affected

\- ideas are difficult to develop



Mistakes alone do NOT justify Band 4.





# ============================================================

BAND 5

# ============================================================



Typical characteristics:



\- can answer familiar questions

\- limited but usable vocabulary

\- frequent errors

\- noticeable hesitation

\- ideas may be repetitive

\- communication is possible but not consistently smooth





# ============================================================

BAND 6

# ============================================================



Typical characteristics:



\- generally clear communication

\- relevant answers

\- can extend answers

\- adequate vocabulary

\- some less common vocabulary

\- noticeable grammar errors

\- mixture of simple and complex structures

\- some hesitation may occur





# ============================================================

BAND 6.5

# ============================================================



Typical characteristics:



\- stronger than typical Band 6

\- generally fluent

\- answers are developed

\- good vocabulary range

\- reasonable grammar flexibility

\- errors are present but not dominant

\- communication remains clear

\- natural discussion of familiar topics





# ============================================================

BAND 7

# ============================================================



Typical characteristics:



\- speaks at length without noticeable effort

\- hesitation does not usually affect coherence

\- flexible vocabulary

\- some less common and idiomatic language

\- good grammatical control

\- variety of complex structures

\- relatively infrequent errors

\- pronunciation generally easy to understand





# ============================================================

BAND 8

# ============================================================



Typical characteristics:



\- fluent and effortless

\- precise vocabulary

\- very good grammar control

\- wide range of structures

\- occasional errors

\- pronunciation easy to understand

\- ideas developed naturally





# ============================================================

PART 1

# ============================================================



Part 1 answers are naturally shorter than Part 3 answers.



Do NOT penalize a student merely because a Part 1 answer is short.



A natural answer of approximately 15–30 seconds can be completely

appropriate if it directly answers the question and develops it

sufficiently.



Do not require academic vocabulary.



Do not require complex arguments.



Do not give Band 4 simply because an answer is simple.





# ============================================================

FLUENCY

# ============================================================



Consider:



\- ability to keep speaking

\- logical progression

\- appropriate expansion

\- hesitation

\- repetition

\- self-correction

\- linking

\- relevance



The transcript cannot perfectly measure real-time fluency.



Do not invent hesitation or pauses that are not supported.





# ============================================================

LEXICAL RESOURCE

# ============================================================



Consider:



\- range

\- precision

\- flexibility

\- paraphrasing

\- repetition

\- natural collocations



Simple accurate vocabulary is NOT automatically Band 4 or 5.





# ============================================================

GRAMMAR

# ============================================================



Consider:



\- sentence variety

\- simple structures

\- complex structures

\- verb forms

\- articles

\- prepositions

\- agreement

\- accuracy



One or two grammar mistakes do NOT justify Band 4.



Judge the overall pattern.





# ============================================================

PRONUNCIATION

# ============================================================



The system currently provides a transcription.



A transcript cannot perfectly measure:



\- individual sounds

\- stress

\- intonation

\- rhythm

\- connected speech



Therefore pronunciation is an:



"AI practice estimate"



and NOT an official IELTS pronunciation score.



Do not invent pronunciation problems that cannot be supported.





# ============================================================

ANTI-UNDER-SCORING RULE

# ============================================================



Do NOT use:



"mistake = Band 4"



Do NOT use:



"not perfect = Band 5"



Instead ask:



"What band best describes the student's overall performance?"





A student can receive:



Fluency = 6.5

Lexical Resource = 6.0

Grammar = 6.0

Pronunciation = 6.0



even when mistakes exist.



This is a realistic result.





# ============================================================

RETURN JSON ONLY

# ============================================================



{{

    "overall_band": 0.0,

    "fluency_coherence": 0.0,

    "lexical_resource": 0.0,

    "grammatical_range_accuracy": 0.0,

    "pronunciation": 0.0,

    "summary": "",

    "strengths": [],

    "weaknesses": [],

    "grammar_corrections": [],

    "vocabulary_suggestions": [],

    "fluency_advice": [],

    "pronunciation_advice": [],

    "next_steps": []

}}





# ============================================================

STUDENT PERFORMANCE

# ============================================================



{combined_answers}

"""





    response = (

        groq.chat.completions.create(

            model=WRITING_MODEL,

            temperature=0.15,

            max_tokens=5000,

            messages=[

                {

                    "role": "system",

                    "content": (

                        "You are an evidence-based IELTS "

                        "Speaking examiner. "

                        "Use IELTS-style band calibration. "

                        "Do not artificially lower scores. "

                        "Return valid JSON only."

                    )

                },

                {

                    "role": "user",

                    "content": prompt

                }

            ]

        )

    )





    result = parse_ai_json(

        response

        .choices[0]

        .message

        .content

        or ""

    )





    fluency = clamp_band(

        result.get(

            "fluency_coherence"

        )

    )



    lexical = clamp_band(

        result.get(

            "lexical_resource"

        )

    )



    grammar = clamp_band(

        result.get(

            "grammatical_range_accuracy"

        )

    )



    pronunciation = clamp_band(

        result.get(

            "pronunciation"

        )

    )





    overall = calculate_ielts_overall([

        fluency,

        lexical,

        grammar,

        pronunciation

    ])





    result[

        "fluency_coherence"

    ] = fluency



    result[

        "lexical_resource"

    ] = lexical



    result[

        "grammatical_range_accuracy"

    ] = grammar



    result[

        "pronunciation"

    ] = pronunciation



    result[

        "overall_band"

    ] = overall



    result[

        "answers_evaluated"

    ] = len(part1_answers)





    result["strengths"] = normalize_list(

        result.get("strengths")

    )



    result["weaknesses"] = normalize_list(

        result.get("weaknesses")

    )



    result["grammar_corrections"] = normalize_list(

        result.get("grammar_corrections")

    )



    result["vocabulary_suggestions"] = normalize_list(

        result.get("vocabulary_suggestions")

    )



    result["fluency_advice"] = normalize_list(

        result.get("fluency_advice")

    )



    result["pronunciation_advice"] = normalize_list(

        result.get("pronunciation_advice")

    )



    result["next_steps"] = normalize_list(

        result.get("next_steps")

    )





    return result





# ============================================================

# ERROR HANDLER

# ============================================================



@app.exception_handler(Exception)

async def global_exception_handler(

    request,

    exc

):



    if isinstance(

        exc,

        HTTPException

    ):



        return JSONResponse(

            status_code=exc.status_code,

            content={

                "detail": exc.detail

            }

        )





    print(

        "SERVER ERROR:",

        repr(exc)

    )





    return JSONResponse(

        status_code=500,

        content={

            "detail": "Internal server error."

        }

    )





# ============================================================

# SERVER

# ============================================================



if __name__ == "__main__":



    import uvicorn



    # Hosting platforms usually provide PORT.

    # Local computer uses 8000.

    host = os.getenv(

        "HOST",

        "0.0.0.0"

    )



    port = int(

        os.getenv(

            "PORT",

            "8000"

        )

    )



    print()

    print("=" * 60)

    print("SBS AI EXAMINER")

    print("=" * 60)

    print(

        f"Server: http://127.0.0.1:{port}"

    )

    print(

        "Hosting mode: enabled"

    )

    print("=" * 60)

    print()



    uvicorn.run(

        "app:app",

        host=host,

        port=port,

        reload=True

    )
