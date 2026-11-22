import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'
import multer from "multer";
import { jwtVerify, createRemoteJWKSet } from "jose";

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

const JWKS = createRemoteJWKSet(new URL(`${process.env.AUTH_URL}/api/auth/jwks`));

const verifyJwt = async (req, res, next) => {
    try {
        const header = req.headers.authorization || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;
        if (!token) return res.status(401).json({ message: "Token missing" });

        const { payload } = await jwtVerify(token, JWKS, {
            issuer: process.env.AUTH_URL,
            audience: process.env.AUTH_URL,
        });

        req.user = {
            id: payload.id ?? payload.sub,
            email: payload.email,
            name: payload.name,
            role: payload.role,
        };
        next();
    } catch (error) {
        console.error("JWT verify failed:", error.message);
        return res.status(401).json({ message: "Invalid or expired token" });
    }
};

const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
        return res.status(403).json({ message: "Forbidden" });
    }
    next();
};

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

        query.status = "Approved";

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



app.post("/equipments", verifyJwt, requireRole("owner"), async (req, res) => {
    try {
        const b = req.body;

        const equipment = {
            name: b.name,
            category: b.category,
            brand: b.brand,
            model: b.model,
            rentalPrice: Number(b.rentalPrice),
            rentalType: b.rentalType,
            location: b.location,
            quantity: Number(b.quantity),
            condition: b.condition,
            description: b.description,
            rentalTerms: b.rentalTerms,
            images: Array.isArray(b.images) ? b.images : [],
            ownerId: req.user.id,
            owner: { id: req.user.id, name: req.user.name, email: req.user.email },
            status: "Pending",
            createdAt: new Date().toISOString(),
        };

        if (!equipment.name || !(equipment.rentalPrice > 0) || !(equipment.quantity >= 1)) {
            return res.status(400).json({ success: false, message: "Invalid equipment data" });
        }

        const result = await equipments.insertOne(equipment);

        res.status(201).json({
            success: true,
            message: "Equipment created successfully",
            insertedId: result.insertedId,
        });
    } catch (error) {
        console.error("Create equipment error:", error);
        res.status(500).json({ success: false, message: "Failed to create equipment" });
    }
});


app.delete("/equipments/:id", verifyJwt, requireRole("owner", "admin"), async (req, res) => {
    try {
        const filter = { _id: new ObjectId(req.params.id) };
        if (req.user.role === "owner") filter.ownerId = req.user.id;

        const result = await equipments.deleteOne(filter);
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Equipment not found" });
        }
        res.json(result);
    } catch (error) {
        console.error("Delete equipment error:", error);
        res.status(500).json({ message: "Failed to delete equipment" });
    }
});

app.patch("/equipments/:id", verifyJwt, requireRole("owner"), async (req, res) => {
    try {
        const { updates } = req.body;
        if (!updates) {
            return res.status(400).json({ message: "Invalid request" });
        }

        const allowed = [
            "name", "category", "brand", "model", "rentalPrice", "rentalType",
            "location", "quantity", "condition", "description", "rentalTerms",
        ];
        const $set = {};
        for (const key of allowed) {
            if (updates[key] !== undefined) $set[key] = updates[key];
        }

        if ($set.rentalPrice !== undefined) $set.rentalPrice = Number($set.rentalPrice);
        if ($set.quantity !== undefined) $set.quantity = Number($set.quantity);
        if (
            ($set.rentalPrice !== undefined && !($set.rentalPrice > 0)) ||
            ($set.quantity !== undefined && !($set.quantity >= 1))
        ) {
            return res.status(400).json({ message: "Invalid price or quantity" });
        }

        // ownerId token theke, tai onno owner er equipment e haat dewa jabe na
        const result = await equipments.updateOne(
            { _id: new ObjectId(req.params.id), ownerId: req.user.id },
            { $set }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: "Equipment not found" });
        }
        res.json(result);
    } catch (error) {
        console.error("Update equipment error:", error);
        res.status(500).json({ message: "Failed to update equipment" });
    }
});

app.get("/bookings", verifyJwt, async (req, res) => {
    try {
        const query = {};

        // token theke nijer data-i shudhu, query theke na
        if (req.user.role === "customer") query.userId = req.user.id;
        else if (req.user.role === "owner") query.ownerId = req.user.id;
        else if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Forbidden" });
        }

        const result = await bookings.find(query).sort({ bookedAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        console.error("Fetch bookings error:", error);
        res.status(500).json({ message: "Failed to fetch bookings" });
    }
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
        booking.ownerId = equipment.ownerId ?? null; 

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
app.get("/admin/users", verifyJwt, requireRole("admin"), async (req, res) => {
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


app.get("/admin/stats", verifyJwt, requireRole("admin"), async (req, res) => {
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


app.get("/owner/stats", requireInternalKey, async (req, res) => {
    try {
        const { ownerId } = req.query;
        if (!ownerId) {
            return res.status(400).json({ message: "ownerId is required" });
        }

        const today = new Date().toISOString().split("T")[0];

        const [
            myEquipment,
            pendingApprovals,
            totalRentals,
            activeRentals,
            completedRentals,
            earnings,
        ] = await Promise.all([
            equipments.countDocuments({ ownerId }),
            equipments.countDocuments({ ownerId, status: "Pending" }),
            bookings.countDocuments({ ownerId }),
            bookings.countDocuments({
                ownerId,
                status: "Confirmed",
                endDate: { $gte: today },
            }),
            bookings.countDocuments({
                ownerId,
                $or: [
                    { status: "Completed" },
                    { status: "Confirmed", endDate: { $lt: today } },
                ],
            }),
            bookings
                .aggregate([
                    { $match: { ownerId, paymentStatus: "Paid" } },
                    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
                ])
                .toArray(),
        ]);

        res.json({
            myEquipment,
            pendingApprovals,
            totalRentals,
            activeRentals,
            completedRentals,
            totalEarnings: earnings[0]?.total ?? 0,
        });
    } catch (error) {
        console.error("Fetch owner stats error:", error);
        res.status(500).json({ message: "Failed to fetch owner stats" });
    }
});

app.get("/owner/equipments", requireInternalKey, async (req, res) => {
    try {
        const { ownerId } = req.query;
        if (!ownerId) {
            return res.status(400).json({ message: "ownerId is required" });
        }

        const result = await equipments
            .find({ ownerId: String(ownerId) })
            .sort({ createdAt: -1 })
            .toArray();

        res.json(result);
    } catch (error) {
        console.error("Fetch owner equipments error:", error);
        res.status(500).json({ message: "Failed to fetch owner equipments" });
    }
});

app.get("/customer/stats", requireInternalKey, async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ message: "userId is required" });
        }

        const today = new Date().toISOString().split("T")[0];

        const [
            totalBookings,
            activeRentals,
            upcomingRentals,
            completedRentals,
            spent,
            favoriteCount,
        ] = await Promise.all([
            bookings.countDocuments({ userId }),
            bookings.countDocuments({
                userId,
                status: "Confirmed",
                startDate: { $lte: today },
                endDate: { $gte: today },
            }),
            bookings.countDocuments({
                userId,
                status: "Confirmed",
                startDate: { $gt: today },
            }),
            bookings.countDocuments({
                userId,
                $or: [
                    { status: "Completed" },
                    { status: "Confirmed", endDate: { $lt: today } },
                ],
            }),
            bookings
                .aggregate([
                    { $match: { userId, paymentStatus: "Paid" } },
                    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
                ])
                .toArray(),
            favorites.countDocuments({ userId }),
        ]);

        res.json({
            totalBookings,
            activeRentals,
            upcomingRentals,
            completedRentals,
            totalSpent: spent[0]?.total ?? 0,
            favorites: favoriteCount,
        });
    } catch (error) {
        console.error("Fetch customer stats error:", error);
        res.status(500).json({ message: "Failed to fetch customer stats" });
    }
});

app.patch("/admin/users/:id/role", verifyJwt, requireRole("admin"), async (req, res) => {
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


app.get("/admin/bookings", verifyJwt, requireRole("admin"), async (req, res) => {
    try {
        const result = await bookings.find({}).sort({ bookedAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        console.error("Fetch bookings error:", error);
        res.status(500).json({ message: "Failed to fetch bookings" });
    }
});

app.get("/admin/equipments", verifyJwt, requireRole("admin"), async (req, res) => {
    try {
        const result = await equipments.find({}).sort({ createdAt: -1 }).toArray();
        res.json(result);
    } catch (error) {
        console.error("Fetch admin equipments error:", error);
        res.status(500).json({ message: "Failed to fetch equipments" });
    }
});

app.patch("/equipments/:id/status", verifyJwt, requireRole("admin"), async (req, res) => {
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

export default app;