from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from extensions import mongo
from bson import ObjectId

classroom_bp = Blueprint("classroom", __name__)

@classroom_bp.route("/create", methods=["POST"])
@jwt_required()
def create_classroom():
    uid = ObjectId(get_jwt_identity())
    cid = mongo.classrooms.insert_one({
        "name": request.json["name"],
        "crIds": [uid],
        "members": [uid]
    }).inserted_id
    return jsonify({"classroomId": str(cid)})

@classroom_bp.route("/my")
@jwt_required()
def my_classrooms():
    uid = ObjectId(get_jwt_identity())
    cls = list(mongo.classrooms.find({"members": uid}))
    return jsonify([{"id": str(c["_id"]), "name": c["name"]} for c in cls])
