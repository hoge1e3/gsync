import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as assert from "assert";

import { Repo } from "../src/git.js";
import { commit, clone, sync, init } from "../src/cmd.js";
import { asFilePath, asBranchName, asLocalRef, isHash } from "../src/types.js";
import { GIT_DIR_NAME, Sync } from "../src/sync.js";

const mainBranch = asBranchName("main");
const mainRef = asLocalRef(mainBranch);
const serverUrl="http://localhost/gsync/index.php";
const cleanups=[] as (()=>any)[];
function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function initRepo(dir: string): Promise<Sync> {
  fs.mkdirSync(dir, { recursive: true });
  await init(dir, serverUrl,GIT_DIR_NAME );
  const sync = new Sync(asFilePath(path.join(dir, GIT_DIR_NAME)));
  return sync;
}

export async function test_scenario_basic_sync() {
  const testdir="../cotest";
  //
  // 1) origin を初期化
  //
  const originDir = asFilePath(fs.mkdtempSync(path.join(testdir, "origin-")));
  cleanups.push(()=>fs.rmSync(originDir, { recursive: true, force: true }));
  const originRepo = await initRepo(originDir);

  // ワーキングツリーにファイルを作る
  write(path.join(originDir, "a.txt"), "hello");
  write(path.join(originDir, "b.txt"), "world");

  // コミット
  const firstCommit = await commit(originDir);
  console.log("first commit",firstCommit);
  assert.ok(isHash(firstCommit), "initial commit should exist");

  // sync
  await sync(originDir,"saveHashedRemote");
  
  //
  // 3) 別フォルダに clone
  //
  const cloneDir = fs.mkdtempSync(path.join(testdir, "clone-"));
  cleanups.push(()=>fs.rmSync(cloneDir, { recursive: true, force: true }));

  const conf = await originRepo.readConfig();
  await clone(cloneDir, conf.serverUrl, conf.repoId);

  // clone 先でファイルが取れていることを確認
  assert.equal(
    fs.readFileSync(path.join(cloneDir, "a.txt"), "utf8"),
    "hello"
  );
  assert.equal(
    fs.readFileSync(path.join(cloneDir, "b.txt"), "utf8"),
    "world"
  );

  //
  // 4) clone 側で更新してコミット
  //
  write(path.join(cloneDir, "c.txt"), "new file");

  const secondCommit = await commit(cloneDir);
  console.log("secondCommit",secondCommit);
  assert.ok(isHash(secondCommit), "second commit should exist");

  const sync_clone=new Sync(asFilePath(path.join(cloneDir,GIT_DIR_NAME)));
  assert.ok( await sync_clone.hasRemoteHead(mainBranch), " has remote head should be set" );
  //
  // 5) clone → remote に push
  //
  await sync(cloneDir, "saveHashedRemote");

  //
  // 6) origin 側を pull して更新されることを確認
  //
  await sync(originDir, "saveHashedRemote");

  assert.equal(
    fs.readFileSync(path.join(originDir, "c.txt"), "utf8"),
    "new file"
  );
}
export async function main(){
  await test_scenario_basic_sync();
  console.log("Cleanup");
  for (let f of cleanups) await f();
  console.log("All test passed.");
}
main();