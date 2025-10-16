import "reflect-metadata" // allows the decorator to work
import express from "express"
import "./controllers/User.controller"
import "./controllers/Spotify.controller"
import "./controllers/Set.controller"
import "./controllers/AuthX.controller"
import "./infra/redis"

// This is the dependency injection container that will allow us to retrieve and resolve some instances from the Dependency Injection container
import { Container } from "inversify"
import { InversifyExpressServer } from "inversify-express-utils"
import cors from "cors"
import cookieParser from "cookie-parser"
import { AuthMiddleware } from "./middleware/Auth.middleware";
import UserRepository from "./repos/User.repository"
import UserService from "./services/User.service"
import SpotifyService from "./services/Spotify.service"
import SpotifyTokenRepository from "./repos/SpotifyToken.repository"
import SetService from "./services/Set.service"
import SetRepository from "./repos/Set.repository"
import TrackServiceCache from './services/TrackCache.service'
import AuthTokenService from "./services/AuthToken.service"
import EmailService from "./services/Email.service"

const app = express()

const allowedOrigins = [process.env.APP_ORIGIN || "https://montana-kinase-raw-collectors.trycloudflare.com"];

app.use(cors({ origin: allowedOrigins, credentials: true })) // if needed for cookies/auth
app.use(express.json())
app.use(cookieParser())
app.set('trust proxy', 1)

const container = new Container({ defaultScope: "Singleton" })

container.bind(AuthMiddleware).toSelf()
container.bind(UserRepository).toSelf()
container.bind(UserService).toSelf()
container.bind(SpotifyService).toSelf()
container.bind(SpotifyTokenRepository).toSelf()
container.bind(SetService).toSelf()
container.bind(SetRepository).toSelf()
container.bind(TrackServiceCache).toSelf()
container.bind(AuthTokenService).toSelf()
container.bind(EmailService).toSelf()

let server = new InversifyExpressServer(
  container,
  null,
  { rootPath: "/api" },
  app
)

let appConfigured = server.build()

//// You need to avoid calling app when appConfigured listens when you run tests. So we don't listen in this file
export { app, appConfigured }
