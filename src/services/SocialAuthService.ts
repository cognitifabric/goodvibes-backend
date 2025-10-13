import { injectable, inject } from "inversify";
import axios from "axios";
import jwt from "jsonwebtoken";
import UserRepository from "../repos/User.repository";