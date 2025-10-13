// src/controllers/Set.controller.ts
import "reflect-metadata";
import { Request, Response } from "express";
import { controller, httpPost, httpDelete, httpPatch, interfaces } from "inversify-express-utils";
import { AuthMiddleware } from "../middleware/Auth.middleware";
import SetService from "../services/Set.service";

//// SCHEMAS AND INTERFACES
import { CreateSetSchema } from "../interfaces/set.interface";
import { AddSongsSchema } from "../interfaces/setEdit.interface";
import { ReplaceSongsSchema } from "../interfaces/replaceSongs.interface";
import { UpdateSetSchema } from "../interfaces/set.update.interface";

type RemoveSongsBody = { songs: string[] };

@controller("/sets")
export default class SetController implements interfaces.Controller {
  constructor(private set: SetService) { }

  @httpPost("/create", AuthMiddleware)
  async create(req: Request, res: Response) {

    try {
      const body = await CreateSetSchema.parseAsync(req.body);
      const creatorId = req.user!.id;
      const created = await this.set.createSet(creatorId, body);

      return res.status(201).json(created);

    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({
          error: "ValidationError",
          issues: err.issues.map((i: any) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      return res.status(400).json({ error: err.message ?? "Create set failed" });
    }

  }

  @httpPost("/:setId/songs", AuthMiddleware)
  async addSongs(req: Request, res: Response) {

    try {
      const body = await AddSongsSchema.parseAsync(req.body);
      const { setId } = req.params;
      const userId = req.user!.id;
      console.log("Adding songs", { setId, userId, songs: body.songs });
      const result = await this.set.addSongs(setId, userId, body.songs);
      res.json(result);
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ error: "ValidationError", issues: err.issues });
      }
      const status = err?.message === "Forbidden" ? 403 : err?.message === "Set not found" ? 404 : 400;
      return res.status(status).json({ error: err.message ?? "Add songs failed" });
    }

  }

  @httpPatch("/:setId/songs", AuthMiddleware)
  async replaceSongs(req: Request, res: Response) {
    try {
      const body = await ReplaceSongsSchema.parseAsync(req.body);
      const { setId } = req.params;
      const userId = req.user!.id;

      const result = await this.set.replaceSongs(setId, userId, body.songs);
      res.json(result);
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ error: "ValidationError", issues: err.issues });
      }
      const status = err?.message === "Forbidden" ? 403 : err?.message === "Set not found" ? 404 : 400;
      return res.status(status).json({ error: err.message ?? "Replace songs failed" });
    }
  }

  @httpPatch("/:setId", AuthMiddleware)
  async updateBasic(req: Request, res: Response) {
    try {
      const body = await UpdateSetSchema.parseAsync(req.body);
      const { setId } = req.params;
      const userId = req.user!.id;

      const updated = await this.set.updateSetBasic(setId, userId, body);
      return res.json(updated);
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({
          error: "ValidationError",
          issues: err.issues.map((i: any) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const status =
        err?.message === "Forbidden" ? 403 :
          err?.message === "Set not found" ? 404 : 400;
      return res.status(status).json({ error: err.message ?? "Update failed" });
    }
  }

}