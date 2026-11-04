import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { currentAuditContext, type AuditContext } from "./context";
import { auditPolicies } from "./policy";
import { assertReviewedRaw } from "./raw";

type Tx = Prisma.TransactionClient;
type Scope = { tx: Tx; tail: Promise<unknown>; failure?: unknown; failed: boolean; auditContext: AuditContext };
const globalForTransactions = globalThis as unknown as { eventSeriesAuditTransactions?: AsyncLocalStorage<Scope> };
const transactions = globalForTransactions.eventSeriesAuditTransactions ??= new AsyncLocalStorage<Scope>();
const writes = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert"]);
const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
const delegates = new Map([...models.keys()].map((name) => [name[0].toLowerCase() + name.slice(1), name]));
const primaryKeyParents = new Set(["Company", "User", "Venue", "Trainer", ...Object.keys(auditPolicies)]);
type Policy = {
  delegate: string;
  fields: Readonly<Record<string, string>>;
  privateFields: Readonly<Record<string, string>>;
  affectedBy: readonly { model: string; operations: readonly string[] }[];
};
const policies: [string, Policy][] = Object.entries(auditPolicies);
function policiesForWrite(model: string, operation: string) {
  return policies.filter(([name, policy]) => name === model || policy.affectedBy.some((effect) => effect.model === model && effect.operations.includes(operation)));
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};

// A nested relation can mutate EventSeries even when its parent is not audited.
function inspectData(model: string, value: unknown): void {
  for (const data of Array.isArray(value) ? value : [value]) {
    const fields = object(data);
    for (const field of models.get(model)?.fields ?? []) {
      if (field.kind !== "object" || !(field.name in fields)) continue;
      const nested = object(fields[field.name]);
      if (field.type === "AuditLog" || field.type in auditPolicies) {
        throw new Error(`Audit: verschachtelte Schreibzugriffe auf ${field.type} sind nicht unterstützt. Verwende direkte Modelloperationen in einer Callback-Transaktion.`);
      }
      for (const [operation, payload] of Object.entries(nested)) {
        if (field.type === "Trainer" && ["delete", "deleteMany"].includes(operation)) {
          throw new Error("Audit: verschachtelte Trainerlöschungen sind wegen EventSeries-SetNull nicht unterstützt.");
        }
        if (["connect", "disconnect", "set", "delete", "deleteMany"].includes(operation)) continue;
        for (const item of Array.isArray(payload) ? payload : [payload]) {
          const args = object(item);
          if (operation === "create") inspectData(field.type, item);
          else if (operation === "createMany") inspectData(field.type, args.data);
          else if (operation === "connectOrCreate") inspectData(field.type, args.create);
          else if (operation === "upsert") {
            inspectUpdate(field.type, args.update);
            inspectData(field.type, args.create);
          } else if (operation === "update" || operation === "updateMany") inspectUpdate(field.type, args.data ?? item);
          else throw new Error(`Audit: verschachtelte Operation ${operation} ist nicht freigegeben.`);
        }
      }
    }
  }
}

function inspectUpdate(model: string, value: unknown) {
  if (primaryKeyParents.has(model) && "id" in object(value)) {
    throw new Error("Audit: Primärschlüsseländerungen mit möglicher EventSeries-Kaskade sind nicht erlaubt.");
  }
  // Moving a series between tenants would expose its old history to the new tenant.
  if (model === "EventSeries" && ("companyId" in object(value) || "company" in object(value))) {
    throw new Error("Audit: ein Company-Wechsel einer Veranstaltungsreihe ist nicht unterstützt.");
  }
  inspectData(model, value);
}

function inspectWrite(model: string, operation: string, args: ObjectValue) {
  if (model === "AuditLog") throw new Error("Audit: AuditLog ist über den Anwendungsclient schreibgeschützt.");
  if (operation === "upsert") {
    inspectData(model, args.create);
    inspectUpdate(model, args.update);
  } else if (operation.startsWith("update")) inspectUpdate(model, args.data);
  else if (operation.startsWith("create")) inspectData(model, args.data);
}

type Snapshot = { id: string; companyId: string; [field: string]: unknown };
function jsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value == null) return null;
  if (Prisma.Decimal.isDecimal(value)) return value.toFixed(2);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new Error("Audit: unsupported value in explicit field policy.");
}

async function snapshots(tx: Tx, policy: Policy): Promise<Snapshot[]> {
  const select = Object.fromEntries(["id", ...Object.keys(policy.fields), ...Object.keys(policy.privateFields)].map((field) => [field, true]));
  const delegate = Reflect.get(tx, policy.delegate);
  return await Reflect.apply(Reflect.get(delegate, "findMany"), delegate, [{ select }]) as Snapshot[];
}

async function recordChanges(tx: Tx, model: string, policy: Policy, before: Snapshot[], after: Snapshot[], operation: string, context: AuditContext) {
  const previous = new Map(before.map((row) => [row.id, row]));
  const next = new Map(after.map((row) => [row.id, row]));
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(id);
    const row = next.get(id);
    const changedFields: string[] = [];
    const redactedFields: string[] = [];
    const oldValues: Record<string, Prisma.InputJsonValue | null> = {};
    const newValues: Record<string, Prisma.InputJsonValue | null> = {};
    for (const field of Object.keys(policy.fields)) {
      const a = old ? jsonValue(old[field]) : null;
      const b = row ? jsonValue(row[field]) : null;
      if (!old || !row || a !== b) {
        changedFields.push(field);
        if (old) oldValues[field] = a;
        if (row) newValues[field] = b;
      }
    }
    if (old && row) {
      for (const field of Object.keys(policy.privateFields)) {
        if (old[field] !== row[field]) redactedFields.push(field);
      }
    }
    if (old && row && !changedFields.length && !redactedFields.length) continue;
    await tx.auditLog.create({ data: {
      model, recordId: id, companyId: (row ?? old)!.companyId,
      action: !old ? "CREATE" : !row ? "DELETE" : "UPDATE", operation,
      ...context, changedFields, redactedFields, policyVersion: 3,
      before: old ? oldValues : Prisma.DbNull,
      after: row ? newValues : Prisma.DbNull,
    } });
  }
}

// Full, explicitly projected snapshots under a table lock deliberately favor
// correctness for the pilot (bulk predicates, skipDuplicates, arbitrary select,
// upsert and Trainer ON DELETE SET NULL). See docs/audit-logging.md for cost.
async function auditedWrite(tx: Tx, model: string, operation: string, args: unknown[], context: AuditContext) {
  const affected = policiesForWrite(model, operation).sort(([a], [b]) => a.localeCompare(b));
  for (const [name] of affected) {
    const metadata = models.get(name);
    if (!metadata) throw new Error("Audit: unregistered schema model.");
    // Identifier comes exclusively from the server-owned policy and Prisma schema.
    const table = Prisma.raw(`"${(metadata.dbName ?? metadata.name).replaceAll('"', '""')}"`);
    await tx.$executeRaw(Prisma.sql`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
  }
  const before = await Promise.all(affected.map(([, policy]) => snapshots(tx, policy)));
  const result = await invoke(tx, model, operation, args);
  for (let index = 0; index < affected.length; index++) {
    const [name, policy] = affected[index];
    await recordChanges(tx, name, policy, before[index], await snapshots(tx, policy), `${model}.${operation}`, context);
  }
  return result;
}

function invoke(tx: Tx, model: string, operation: string, args: unknown[]) {
  const delegate = Reflect.get(tx, model[0].toLowerCase() + model.slice(1));
  return Reflect.apply(Reflect.get(delegate, operation), delegate, args) as Promise<unknown>;
}

// Keep writes lazy: $transaction([client.eventSeries.create(...)]) must be
// rejected before any operation can commit outside that transaction.
function lazy(work: () => Promise<unknown>) {
  let promise: Promise<unknown> | undefined;
  const run = () => promise ??= Promise.resolve().then(work);
  return {
    [Symbol.toStringTag]: "PrismaPromise",
    then: (...args: Parameters<Promise<unknown>["then"]>) => run().then(...args),
    catch: (...args: Parameters<Promise<unknown>["catch"]>) => run().catch(...args),
    finally: (...args: Parameters<Promise<unknown>["finally"]>) => run().finally(...args),
  };
}

export function createAuditedClient(base: PrismaClient): PrismaClient {
  async function transaction(work: (tx: Tx) => Promise<unknown>, options?: object, auditContext = currentAuditContext()) {
    if (transactions.getStore()) throw new Error("Audit: verschachtelte $transaction-Aufrufe sind nicht unterstützt; verwende den vorhandenen tx-Client.");
    return base.$transaction(async (tx) => {
      const scope: Scope = { tx, tail: Promise.resolve(), failed: false, auditContext };
      return transactions.run(scope, async () => {
        const result = await work(wrap(tx, scope));
        await scope.tail;
        if (scope.failed) throw scope.failure;
        return result;
      });
    }, options);
  }

  function mutate(model: string, operation: string, args: unknown[], context: AuditContext, scope?: Scope): Promise<unknown> {
    const execute = async (tx: Tx) => {
      inspectWrite(model, operation, object(args[0]));
      if (policiesForWrite(model, operation).length) {
        return auditedWrite(tx, model, operation, args, context);
      }
      return invoke(tx, model, operation, args);
    };
    if (!scope) {
      // Existing unrelated writes retain their original transaction behavior.
      if (!policiesForWrite(model, operation).length) {
        inspectWrite(model, operation, object(args[0]));
        return invoke(base, model, operation, args);
      }
      return transaction(async () => execute(transactions.getStore()!.tx), undefined, context);
    }
    const result = scope.tail.then(() => {
      if (scope.failed) throw scope.failure;
      return execute(scope.tx);
    });
    scope.tail = result.catch((error: unknown) => { scope.failed = true; scope.failure = error; });
    return result;
  }

  function wrap(target: Tx | PrismaClient, boundScope?: Scope): PrismaClient {
    return new Proxy(target, {
      get(client, key) {
        const scope = boundScope ?? transactions.getStore();
        const actual = scope?.tx ?? client;
        if (key === "$extends") return () => { throw new Error("Audit: Erweiterungen dürfen nur intern am zentralen Prisma-Client eingerichtet werden."); };
        if (key === "$transaction") return (work: unknown, options?: object) => {
          if (typeof work !== "function") throw new Error("Audit: $transaction([...]) ist nicht unterstützt. Verwende eine interaktive Callback-Transaktion.");
          return transaction(work as (tx: Tx) => Promise<unknown>, options);
        };
        if (typeof key === "string" && key.startsWith("$") && /Raw/.test(key)) {
          return (...args: unknown[]) => lazy(async () => {
            assertReviewedRaw(key, args[0]);
            return Reflect.apply(Reflect.get(actual, key), actual, args);
          });
        }
        const model = typeof key === "string" ? delegates.get(key) : undefined;
        const value = Reflect.get(actual, key);
        if (model) return new Proxy(value, {
          get(delegate, method) {
            const member = Reflect.get(delegate, method);
            if (typeof member !== "function") return member;
            if (typeof method === "string" && writes.has(method)) {
              return (...args: unknown[]) => {
                // Capture before Prisma callbacks / deferred promises can cross
                // async-resource boundaries. Never resolve identity inside Prisma.
                const context = currentAuditContext(scope?.auditContext);
                return lazy(() => mutate(model, method, args, context, scope));
              };
            }
            return member.bind(delegate);
          },
        });
        return typeof value === "function" ? value.bind(actual) : value;
      },
    }) as PrismaClient;
  }
  return wrap(base);
}
