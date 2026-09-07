"""Spot-check the populated dev DB against schema.md rules (dev-time helper)."""
from collections import defaultdict
from dotenv import dotenv_values
from pymongo import MongoClient

vals = dotenv_values("atlas-credentials.env")
c = MongoClient(vals["MONGODB_URI"])
db = c[vals.get("MONGODB_DB_NAME", "sih26_dev")]
B32 = lambda s: isinstance(s, str) and len(s) == 66 and s.startswith("0x") and s == s.lower()
ok = True

def check(name, cond):
    global ok
    print(("PASS " if cond else "FAIL ") + name)
    ok = ok and cond

ids = list(db["identities"].find({}))
check("identities.id UID pattern", all(i["id"].startswith("UID") for i in ids))
check("bytes32 shape (did_hash)", all(B32(i["did_hash"]) for i in ids))
check("did pattern", all(isinstance(i["did"], str) and i["did"].startswith("did:sih:") and len(i["did"]) == 72 for i in ids))
active_controllers = [i["controller"] for i in ids if i["status"] == "active"]
check("active controllers unique", len(active_controllers) == len(set(active_controllers)))
did_hashes = {i["did_hash"] for i in ids}

keys = list(db["identity_keys"].find({}))
active_enc = defaultdict(int)
for k in keys:
    if k["key_type"] == "encryption" and k["active_to"] is None:
        active_enc[k["identity_id"]] += 1
check("exactly one active encryption key per identity", all(v == 1 for v in active_enc.values()) and len(active_enc) == len(ids))

blocks = list(db["chain_blocks"].find({}).sort("block_number", 1))
by_num = {b["block_number"]: b for b in blocks}
chain_ok = all(by_num[b["block_number"]]["parent_hash"] == by_num[b["block_number"] - 1]["block_hash"]
               for b in blocks if b["block_number"] - 1 in by_num)
check("block parent-hash chain correct", chain_ok)

perms = list(db["asset_permissions"].find({}))
act = defaultdict(int)
for p in perms:
    if p["active"]:
        act[(p["asset_id"], p["grantee_did_hash"])] += 1
check("unique active (asset, grantee)", all(v == 1 for v in act.values()))

snaps = list(db["merkle_leaf_snapshots"].find({}))
by_group = defaultdict(list)
for s in snaps:
    by_group[(s["did_hash"], s["root_version"])].append(s)
ord_ok = all([x["ordinal"] for x in lst] == list(range(len(lst))) for lst in by_group.values())
ord_sorted = all(int(lst[0]["asset_id"]) < int(lst[-1]["asset_id"]) for lst in by_group.values())
check("snapshot ordinals 0..n-1 per (did,root_version)", ord_ok)
check("snapshot ordinals ascend by asset_id", ord_sorted)

asset_ids = [a["asset_id"] for a in db["assets"].find({})]
check("asset_id large decimal strings", all(a.isdigit() and len(a) >= 10 for a in asset_ids) and len(set(asset_ids)) == len(asset_ids))
vers = list(db["document_versions"].find({}))
per_asset = defaultdict(set)
for v in vers:
    per_asset[v["asset_id"]].add(v["version"])
check("document_versions unique (asset_id, version) from 1",
      all(len(s) == len(list(s)) and min(s) == 1 for s in [set(x) for x in per_asset.values()]))
check("asset.current_version matches version count",
      all(a["current_version"] == len(per_asset.get(a["asset_id"], [])) for a in db["assets"].find({})))
check("no http(s) refs in storage_objects", all(not r["encrypted_object_ref"].startswith("http") for r in db["storage_objects"].find({})))
check("audit source split app/chain", set(db["audit_events"].distinct("source")) == {"app", "chain"})
check("schema_migrations untouched (9 real rows)", db["schema_migrations"].count_documents({}) == 9)

print("\nALL PASS" if ok else "\nFAILURES PRESENT")
