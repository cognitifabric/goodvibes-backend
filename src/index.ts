import 'dotenv/config'
import { appConfigured } from "./app";
import connectDB from "./database";

connectDB() // connect to DB
appConfigured.listen(process.env.PORT, () => console.log(`Listening on port ${process.env.PORT}`))