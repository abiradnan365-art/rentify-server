import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'
import multer from "multer";

const app = express();
const port = process.env.PORT || 5000;


const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
});

//middleware
app.use(cors());
app.use(express.json());

app.post("/upload-image", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Please select an image",
            });
        }

        if (!req.file.mimetype.startsWith("image/")) {
            return res.status(400).json({
                success: false,
                message: "Only image files are allowed",
            });
        }

        const formData = new FormData();

        formData.append(
            "image",
            req.file.buffer.toString("base64")
        );

        const response = await fetch(
            `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
            {
                method: "POST",
                body: formData,
            }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
            return res.status(400).json({
                success: false,
                message: "ImgBB upload failed",
            });
        }

        res.status(200).json({
            success: true,
            imageUrl: result.data.url,
        });

    } catch (error) {
        console.error("Image upload error:", error);

        res.status(500).json({
            success: false,
            message: "Image upload failed",
        });
    }
});



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
const equipments = database.collection("equipments");

app.get("/", (req, res) => {
    res.send("rentify is flying");
})

app.get("/users", async (req, res) => {
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.json(result);
})

app.get("/equipments", async (req, res) => {
    try {
        const query = {};

        if (req.query.category) {
            // special character escape kora (jemon & ba ( ) ) jate regex na bhange
            const escaped = req.query.category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            query.category = { $regex: escaped, $options: "i" };
        }
        if (req.query.location) {
            const escaped = req.query.location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            query.location = { $regex: escaped, $options: "i" };
        }
        if (req.query.condition) {
            const escaped = req.query.condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            query.condition = { $regex: escaped, $options: "i" };
        }
        const min = parseFloat(req.query.minPrice);
        const max = parseFloat(req.query.maxPrice);

        if (!isNaN(min) || !isNaN(max)) {
            query.rentalPrice = {};
            if (!isNaN(min)) query.rentalPrice.$gte = min;
            if (!isNaN(max)) query.rentalPrice.$lte = max;
        }
        if (req.query.search) {
            const escaped = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            query.$or = [
                { name: { $regex: escaped, $options: "i" } },
                { location: { $regex: escaped, $options: "i" } },
                { category: { $regex: escaped, $options: "i" } },
                { rentalType: { $regex: escaped, $options: "i" } },
                { description: { $regex: escaped, $options: "i" } },
                { rentalTerms: { $regex: escaped, $options: "i" } }
            ];
        }

        const result = await equipments.find(query).toArray();
        res.json(result);
    } catch (error) {
        console.error("Fetch equipments error:", error);
        res.status(500).json({ message: "Failed to fetch equipments" });
    }
});

app.post("/equipments", async (req, res) => {
    const equipment = req.body;
    const result = await equipments.insertOne(equipment);
    res.json(result);
});

app.delete("/equipments/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await equipments.deleteOne(query);
    res.json(result);
});

app.listen(port, () => {
    console.log(`rentify is running on port ${port}`);
})