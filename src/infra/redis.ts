// src/infra/redis.ts
import { createClient, RedisClientType } from "redis";

// ---- Redis (node-redis v4) ----
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// declare a client that can be imported elsewhere
export let redisClient: RedisClientType;

(async () => {
  try {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on("error", (err) => {
      console.error("Redis client error:", err);
    });
    await redisClient.connect();
    console.log("Redis connected:", REDIS_URL);
  } catch (err) {
    console.error("Failed to connect to Redis:", err);
    // Optional: exit if Redis is critical
    // process.exit(1);
  }
})();
