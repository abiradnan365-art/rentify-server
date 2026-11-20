import express from "express";
import cors from "cors";

const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(express.json());
app.use(cors());

app.get ("/", (req, res) => {
    res.send("rentify is flying");
})

app.listen(port, () => {
    console.log(`rentify is running on port ${port}`);
})