from pymongo import MongoClient
import os

mongo = None

def init_mongo():
    global mongo
    client = MongoClient(os.getenv("MONGO_URI"))
    mongo = client.iaps