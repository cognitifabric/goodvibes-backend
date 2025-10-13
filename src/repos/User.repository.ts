import { injectable } from "inversify";
import "reflect-metadata"
// import { IUser, UserCreateInput } from "../interfaces/user.interface";
import { Types } from "mongoose";
import User, { UserDoc, UserIdentity } from "../models/user.model"
// CRUD operations

@injectable()
export default class UserRepository {

  create(input: Partial<UserDoc>) { return User.create(input); }
  findById(id: string) { return User.findById(id).lean<UserDoc | null>(); }
  findByEmail(email: string) { return User.findOne({ email }).lean<UserDoc | null>(); }
  findByUsername(username: string) { return User.findOne({ username }).lean<UserDoc | null>(); }

  async updateById(id: string, patch: Partial<UserDoc>) {
    if (!Types.ObjectId.isValid(id)) throw new Error("Invalid id");
    await User.updateOne({ _id: id }, { $set: patch }).exec();
  }

  async pushSet(userId: string, setId: string) {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(setId)) {
      throw new Error("Invalid ObjectId");
    }
    await User.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $addToSet: { sets: new Types.ObjectId(setId) } } // addToSet avoids duplicates
    ).exec();
  }

  async markEmailVerified(userId: string) {
    await User.updateOne(
      { _id: userId },
      { $set: { emailVerified: true, emailVerifiedAt: new Date() } }
    ).exec();
  }


  async findByIdentity(provider: UserIdentity["provider"], providerUserId: string) {
    return User.findOne({ "identities.provider": provider, "identities.providerUserId": providerUserId })
      .lean<UserDoc | null>();
  }

  async addIdentity(userId: string, identity: UserIdentity) {
    await User.updateOne(
      { _id: userId, "identities.provider": { $ne: identity.provider }, "identities.providerUserId": { $ne: identity.providerUserId } },
      { $addToSet: { identities: identity } }
    ).exec();
  }

  async allocateUsername(base: string): Promise<string> {
    const safe = (base || "")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "")
      .slice(0, 32) || "user";

    // Try the base first
    if (!(await User.exists({ username: safe }))) return safe;

    // Try with numeric suffixes
    for (let i = 1; i < 10000; i++) {
      const candidate = `${safe}${i}`.slice(0, 32);
      // Note: exists() returns a doc or null; we only care if it exists
      if (!(await User.exists({ username: candidate }))) return candidate;
    }

    // Extremely unlikely fallback
    return `${safe}${Date.now()}`.slice(0, 32);
  }

}
