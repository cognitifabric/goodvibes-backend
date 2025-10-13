// src/models/Set.model.ts
import { Schema, model, models, Types } from "mongoose";

export type SetSuggestion = {
  _id: Types.ObjectId;
  author: Types.ObjectId;
  proposedQueue?: string[];
  adds?: string[];
  removes?: string[];
  reorder?: { trackId: string; toIndex: number }[];
  status: "open" | "accepted" | "rejected";
  createdAt: Date;
  reviewedAt?: Date;
  reviewer?: Types.ObjectId;
};

export interface SetDoc {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  songs: string[];
  suggestions: SetSuggestion[];
  lovedBy: Types.ObjectId[];
  collaborators: Types.ObjectId[];
  lastCollaboration?: { by: Types.ObjectId; at: Date; suggestionId?: Types.ObjectId };
  tags: string[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SuggestionSchema = new Schema<SetSuggestion>(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    proposedQueue: [String],
    adds: [String],
    removes: [String],
    reorder: [{ trackId: String, toIndex: Number }],
    status: { type: String, enum: ["open", "accepted", "rejected"], default: "open" },
    reviewedAt: Date,
    reviewer: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true, timestamps: { createdAt: "createdAt", updatedAt: false } }
);

const SetSchema = new Schema<SetDoc>(
  {
    name: { type: String, required: true },
    description: String,
    songs: { type: [String], default: [] },
    suggestions: { type: [SuggestionSchema], default: [] },
    lovedBy: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    collaborators: [{ type: Schema.Types.ObjectId, ref: "User" }],
    lastCollaboration: {
      by: { type: Schema.Types.ObjectId, ref: "User" },
      at: Date,
      suggestionId: { type: Schema.Types.ObjectId },
    },
    tags: { type: [String], required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);

export const Set = models.Set || model<SetDoc>("Set", SetSchema);
