// src/repos/Set.repository.ts
import { injectable } from "inversify";
import { Set, SetDoc } from "../models/set.model";
import { ICreateSetInput } from "../interfaces/set.interface";
import { Types } from "mongoose";

@injectable()
export default class SetRepository {

  async create(input: ICreateSetInput) {

    const doc = await Set.create({
      name: input.name,
      description: input.description,
      songs: input.songs,
      tags: input.tags,
      collaborators: input.collaborators.map((id) => new Types.ObjectId(id)),
      createdBy: new Types.ObjectId(input.createdBy),
      // suggestions: [], lovedBy: [] come from schema defaults
    });
    return doc.toObject();

  }

  async findById(setId: string) {
    return Set.findById(setId).lean<SetDoc>();
  }

  async isEditor(setId: string, userId: string): Promise<boolean> {
    const _id = new Types.ObjectId(setId);
    const u = new Types.ObjectId(userId);
    const set = await Set.findOne({
      _id,
      $or: [{ createdBy: u }, { collaborators: u }],
    })
      .select("_id")
      .lean();
    return !!set;
  }

  async setSongs(setId: string, songs: string[]) {
    await Set.updateOne({ _id: setId }, { $set: { songs } }).exec();
  }

  async updateBasic(setId: string, patch: { name?: string; description?: string | null; tags?: string[] }) {
    const update: any = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description ?? null;
    if (patch.tags !== undefined) update.tags = patch.tags;

    const updated = await Set.findByIdAndUpdate(
      setId,
      { $set: update },
      { new: true } // return updated doc
    ).lean<SetDoc>().exec();

    return updated; // may be null if not found
  }

}
