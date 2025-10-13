import mongoose from "mongoose";

console.log('ENV PROD', process.env.NODE_ENV);

const connectDB = async () => {
  try {


    mongoose.set("strictQuery", true)
    const conn = await mongoose.connect(
      process.env.NODE_ENV !== 'development'
        ?
        `mongodb+srv://${process.env.DATABASE_USERNAME}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_URL}?retryWrites=true&w=majority&appName=${process.env.DATABASE_NAME}`
        :
        "mongodb://127.0.0.1:27017/gooodvibez"
    )

    console.log(`MongoDB Connected: ${conn.connection.host}`);

  } catch (error) {

    console.log(`Connection error: ${error} on Worker process: ${process.pid}`)
    process.exit(1);

  }
};

export default connectDB;