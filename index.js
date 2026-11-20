import express from "express";
import cors from "cors";
import { MongoClient } from 'mongodb';
import 'dotenv/config'


const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(express.json());
app.use(cors());



const client = new MongoClient(`mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ac-zunyojn-shard-00-00.azn0teo.mongodb.net:27017,ac-zunyojn-shard-00-01.azn0teo.mongodb.net:27017,ac-zunyojn-shard-00-02.azn0teo.mongodb.net:27017/?ssl=true&replicaSet=atlas-ic6asq-shard-0&authSource=admin`);


export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("rentifydb");
const users = database.collection("user");

app.get("/", (req, res) => {
    res.send("rentify is flying");
})

app.listen(port, () => {
    console.log(`rentify is running on port ${port}`);
})