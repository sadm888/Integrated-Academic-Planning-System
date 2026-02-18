from flask import Blueprint, request, jsonify, redirect
from flask_jwt_extended import (
    create_access_token,
    set_access_cookies
)
import bcrypt, requests, os
from extensions import mongo
from bson import ObjectId

auth_bp = Blueprint("auth", __name__)

def verify_captcha(token):
    r = requests.post(
        "https://www.google.com/recaptcha/api/siteverify",
        data={
            "secret": os.getenv("RECAPTCHA_SECRET"),
            "response": token
        }
    )
    return r.json().get("success", False)

@auth_bp.route("/signup", methods=["POST"])
def signup():
    data = request.json

    if not verify_captcha(data["captcha"]):
        return jsonify({"error": "Captcha failed"}), 400

    hashed = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt())

    mongo.users.insert_one({
        "email": data["email"],
        "username": data["username"],
        "password": hashed,
        "role": "student"
    })

    return jsonify({"ok": True})

@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.json
    user = mongo.users.find_one({
        "$or": [
            {"email": data["identifier"]},
            {"username": data["identifier"]}
        ]
    })

    if not user or not bcrypt.checkpw(
        data["password"].encode(), user["password"]
    ):
        return jsonify({"error": "Invalid creds"}), 401

    token = create_access_token(identity=str(user["_id"]))
    resp = jsonify({"ok": True})
    set_access_cookies(resp, token)
    return resp