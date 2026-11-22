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
const bookings = database.collection("bookings");

await bookings.createIndex({ stripeSessionId: 1 }, { unique: true, sparse: true });
const favorites = database.collection("favorites");
await favorites.createIndex({ userId: 1, equipmentId: 1 }, { unique: true });

const requireInternalKey = (req, res, next) => {
    if (req.headers["x-internal-key"] !== process.env.INTERNAL_API_KEY) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    next();
};

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


        if (req.query.search) {
            const escaped = req.query.search.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

            query.$or = [
                { name: { $regex: escaped, $options: "i" } },
                { location: { $regex: escaped, $options: "i" } },
            ];
        }


        if (req.query.category) {
            query.category = req.query.category;
        }

        if (req.query.ownerId) {
           
            query.ownerId = req.query.ownerId;
        } else if (
            req.query.all === "true" &&
            req.headers["x-internal-key"] === process.env.INTERNAL_API_KEY
        ) {
          
        } else {
            
            query.status = "Approved";
        }

        if (req.query.rentalType) {
            query.rentalType = req.query.rentalType;
        }

        if (req.query.maxPrice) {
            query.rentalPrice = {
                $lte: Number(req.query.maxPrice)
            };
        }

        if (req.query.inStock === "true") {
            query.status = "Approved";
        }


        let sortOption = { createdAt: -1 };

        if (req.query.sort === "price-asc") {
            sortOption = { rentalPrice: 1 };
        } else if (req.query.sort === "price-desc") {
            sortOption = { rentalPrice: -1 };
        }

        const result = await equipments
            .find(query)
            .sort(sortOption)
            .toArray();

        res.json(result);

    } catch (error) {
        console.error("Fetch equipments error:", error);

        res.status(500).json({
            message: "Failed to fetch equipments"
        });
    }
});

app.get("/equipments/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await equipments.findOne(query);
    res.json(result);
});



app.post("/equipments", async (req, res) => {
    try {
        const equipment = req.body;

        const result = await equipments.insertOne(equipment);

        if (!result.acknowledged) {
            return res.status(500).json({
                success: false,
                message: "Equipment creation failed",
            });
        }

        res.status(201).json({
            success: true,
            message: "Equipment created successfully",
            insertedId: result.insertedId,
        });

    } catch (error) {
        console.error("Create equipment error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to create equipment",
        });
    }
});


app.delete("/equipments/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await equipments.deleteOne(query);
    res.json(result);
});

app.get('/bookings', async (req, res) => {

    const query = {};

    if (req.query.customerId) {
        query.userId = req.query.customerId;
    }

    if (req.query.ownerId) {
        query.ownerId = req.query.ownerId;
    }

    const cursor = bookings.find(query);
    const result = await cursor.toArray();
    res.json(result);
});

app.post('/bookings', requireInternalKey, async (req, res) => {
    try {
        const booking = req.body;


        if (booking.stripeSessionId) {
            const existing = await bookings.findOne({ stripeSessionId: booking.stripeSessionId });
            if (existing) {
                return res.json({ acknowledged: true, insertedId: existing._id, duplicate: true });
            }
        }

        const equipment = await equipments.findOne({ _id: new ObjectId(booking.equipmentId) });
        if (!equipment) return res.status(404).json({ message: "Equipment not found" });

        const days = Math.round((new Date(booking.endDate) - new Date(booking.startDate)) / 86400000) + 1;
        if (isNaN(days) || days < 1) {
            return res.status(400).json({ message: "Invalid rental period" });
        }

        const quantity = Number(booking.quantity) || 1;
        if (quantity < 1 || quantity > Number(equipment.quantity)) {
            return res.status(400).json({ message: "Invalid quantity" });
        }

        const type = (equipment.rentalType || "Daily").toLowerCase();
        const units = type === "weekly" ? Math.ceil(days / 7)
            : type === "monthly" ? Math.ceil(days / 30)
                : days;

        booking.quantity = quantity;
        booking.totalDays = days;
        booking.totalAmount = units * Number(equipment.rentalPrice) * quantity;

        const result = await bookings.insertOne(booking);
        res.json(result);
    } catch (error) {
        console.error("Create booking error:", error);
        res.status(500).json({ message: "Failed to create booking" });
    }
})

app.get("/favorites", requireInternalKey, async (req, res) => {
    try {
        const favs = await favorites.find({ userId: req.query.userId }).toArray();
        const ids = favs.map((f) => new ObjectId(f.equipmentId));
        const result = await equipments.find({ _id: { $in: ids } }).toArray();
        res.json(result);
    } catch (error) {
        console.error("Fetch favorites error:", error);
        res.status(500).json({ message: "Failed to fetch favorites" });
    }
});

app.post("/favorites/toggle", requireInternalKey, async (req, res) => {
    try {
        const { userId, equipmentId } = req.body;
        const existing = await favorites.findOne({ userId, equipmentId });

        if (existing) {
            await favorites.deleteOne({ _id: existing._id });
            return res.json({ favorited: false });
        }

        await favorites.insertOne({
            userId,
            equipmentId,
            createdAt: new Date().toISOString(),
        });
        res.json({ favorited: true });
    } catch (error) {
        console.error("Toggle favorite error:", error);
        res.status(500).json({ message: "Failed to update favorite" });
    }
});

// admin
app.get("/admin/users", requireInternalKey, async (req, res) => {
    try {
        const result = await users
            .find({}, { projection: { name: 1, email: 1, role: 1, image: 1, createdAt: 1 } })
            .sort({ createdAt: -1 })
            .toArray();
        res.json(result);
    } catch (error) {
        console.error("Fetch users error:", error);
        res.status(500).json({ message: "Failed to fetch users" });
    }
});


app.get("/admin/stats", requireInternalKey, async (req, res) => {
    try {
        const today = new Date().toISOString().split("T")[0];

        const [
            totalUsers,
            totalEquipment,
            totalBookings,
            pendingApprovals,
            completedRentals,
            revenue,
        ] = await Promise.all([
            users.countDocuments(),
            equipments.countDocuments(),
            bookings.countDocuments(),
            equipments.countDocuments({ status: "Pending" }),
            // Completed status, ba Confirmed kintu end date periye geche
            bookings.countDocuments({
                $or: [
                    { status: "Completed" },
                    { status: "Confirmed", endDate: { $lt: today } },
                ],
            }),
            bookings
                .aggregate([
                    { $match: { paymentStatus: "Paid" } },
                    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
                ])
                .toArray(),
        ]);

        res.json({
            totalUsers,
            totalEquipment,
            totalBookings,
            pendingApprovals,
            completedRentals,
            totalRevenue: revenue[0]?.total ?? 0,
        });
    } catch (error) {
        console.error("Fetch stats error:", error);
        res.status(500).json({ message: "Failed to fetch stats" });
    }
});

app.patch("/admin/users/:id/role", requireInternalKey, async (req, res) => {
    try {
        const { role } = req.body;
        if (!["customer", "owner", "admin"].includes(role)) {
            return res.status(400).json({ message: "Invalid role" });
        }
        const result = await users.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { role } }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json(result);
    } catch (error) {
        console.error("Update role error:", error);
        res.status(500).json({ message: "Failed to update role" });
    }
});


app.get("/admin/bookings", requireInternalKey, async (req, res) => {
    try {
        const result = await bookings.find({}).sort({ bookedAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        console.error("Fetch bookings error:", error);
        res.status(500).json({ message: "Failed to fetch bookings" });
    }
});


app.patch("/equipments/:id/status", requireInternalKey, async (req, res) => {
    try {
        const { status } = req.body;
        if (!["Approved", "Pending"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }
        const result = await equipments.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status } }
        );
        res.json(result);
    } catch (error) {
        console.error("Update status error:", error);
        res.status(500).json({ message: "Failed to update status" });
    }
});

app.listen(port, () => {
    console.log(`rentify is running on port ${port}`);
})