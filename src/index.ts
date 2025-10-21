import 'dotenv/config'
import { appConfigured } from "./app";
import connectDB from "./database";

const port = Number(process.env.PORT) || 3001;          // fallback for local
const host = "0.0.0.0";

connectDB(); // connect to Mongo (see note #4)

appConfigured.listen(port, host, () => {
  console.log(`Listening on port ${port}`);
});
