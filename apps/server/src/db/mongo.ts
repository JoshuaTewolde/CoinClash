import { MongoClient, type Collection, type Db, type Filter } from 'mongodb';
import type { MatchDoc } from '../match/types.js';
import {
  VersionConflictError,
  type MatchRepo,
  type PushRepo,
  type PushSub,
  type UserDoc,
  type UserRepo,
} from './repos.js';

const FINAL = ['SETTLED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'FAILED'];

export class MongoMatchRepo implements MatchRepo {
  constructor(private readonly col: Collection<MatchDoc>) {}

  async insert(doc: MatchDoc) {
    await this.col.insertOne(doc);
  }
  async get(id: string) {
    return this.col.findOne({ _id: id });
  }
  async getByInvite(inviteCode: string) {
    return this.col.findOne({ inviteCode });
  }
  async save(doc: MatchDoc) {
    const res = await this.col.replaceOne({ _id: doc._id, version: doc.version - 1 }, doc);
    if (res.matchedCount !== 1) throw new VersionConflictError(doc._id);
  }
  async listForPlayer(player: string, limit: number) {
    return this.col
      .find({ $or: [{ challenger: player }, { opponent: player }] } as Filter<MatchDoc>)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
  }
  async getByJoinCode(code: string) {
    return this.col.findOne({ joinCode: code, status: 'PROPOSED' } as Filter<MatchDoc>);
  }
  async getByInvoice(invoice: string) {
    return this.col.findOne({ invoices: invoice } as Filter<MatchDoc>);
  }
  async listOpenPayouts() {
    return this.col.find({ payoutsOpen: true } as Filter<MatchDoc>).toArray();
  }
  async listRecentSettled(limit: number) {
    return this.col
      .find({ status: 'SETTLED', mode: 'escrow' } as Filter<MatchDoc>)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
  }
  async listUnfinished() {
    return this.col.find({ status: { $nin: FINAL } } as Filter<MatchDoc>).toArray();
  }
}

export class MongoUserRepo implements UserRepo {
  constructor(private readonly col: Collection<UserDoc>) {}
  async get(id: string) {
    return this.col.findOne({ _id: id });
  }
  async getMany(ids: readonly string[]) {
    return this.col.find({ _id: { $in: [...ids] } }).toArray();
  }
  async upsert(doc: UserDoc) {
    await this.col.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
}

export class MongoPushRepo implements PushRepo {
  constructor(private readonly col: Collection<{ _id: string; userId: string; sub: PushSub }>) {}
  async add(userId: string, sub: PushSub) {
    await this.col.replaceOne({ _id: sub.endpoint }, { userId, sub }, { upsert: true });
  }
  async remove(endpoint: string) {
    await this.col.deleteOne({ _id: endpoint });
  }
  async listFor(userId: string) {
    return (await this.col.find({ userId }).toArray()).map((d) => d.sub);
  }
}

export interface MongoRepos {
  client: MongoClient;
  db: Db;
  matches: MongoMatchRepo;
  users: MongoUserRepo;
  push: MongoPushRepo;
}

export async function connectMongo(uri: string, dbName: string): Promise<MongoRepos> {
  const client = new MongoClient(uri, { appName: 'coinclash' });
  await client.connect();
  const db = client.db(dbName);
  const matches = db.collection<MatchDoc>('matches');
  const users = db.collection<UserDoc>('users');
  const push = db.collection<{ _id: string; userId: string; sub: PushSub }>('push');
  await Promise.all([
    push.createIndex({ userId: 1 }),
    matches.createIndex({ inviteCode: 1 }, { unique: true }),
    matches.createIndex({ challenger: 1, updatedAt: -1 }),
    matches.createIndex({ opponent: 1, updatedAt: -1 }),
    matches.createIndex({ status: 1 }),
    matches.createIndex({ status: 1, updatedAt: -1 }),
    matches.createIndex({ invoices: 1 }),
    matches.createIndex({ joinCode: 1 }, { partialFilterExpression: { status: 'PROPOSED' } }),
    matches.createIndex({ payoutsOpen: 1 }, { partialFilterExpression: { payoutsOpen: true } }),
  ]);
  return {
    client,
    db,
    matches: new MongoMatchRepo(matches),
    users: new MongoUserRepo(users),
    push: new MongoPushRepo(push),
  };
}
