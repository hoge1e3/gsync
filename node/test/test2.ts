import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as assert from "assert";

import { Repo } from "../src/git.js";
import { commit, clone, sync, init, syncWithRetry } from "../src/cmd.js";
import { asFilePath, asBranchName, asLocalRef, isHash, FilePath, Hash } from "../src/types.js";
import { GIT_DIR_NAME, Sync, SyncFactory } from "../src/sync.js";
import { factory as offlineObjectStoreFactory } from "../src/objects.js";
async function offlineRepo(gitDir:FilePath) {
    const objectStore=await offlineObjectStoreFactory(gitDir);
    const repo=new Repo(gitDir,objectStore);
    return repo;
}

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
  const syncf = new SyncFactory(asFilePath(path.join(dir, GIT_DIR_NAME)));
  return await syncf.load();
}
async function getCurrentTreeHash(dir: FilePath): Promise<Hash> {
  //const sync = new Sync(asFilePath(path.join(dir, GIT_DIR_NAME)));
  const repo = await offlineRepo(asFilePath(path.join(dir, GIT_DIR_NAME)));
  const commitHash=(await repo.readHead(asLocalRef(await repo.getCurrentBranchName())) )!;
  const commitObj=await repo.readCommit(commitHash);
  return commitObj.tree;
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
  const firstTree = await getCurrentTreeHash(originDir);
  console.log("firstTree",firstTree);
  assert.ok(isHash(firstTree), "initial commit should exist");
  assert.equal(firstTree,"e30b5202a91c72788d1ce94a3918edb647d2f48c","initial tree hash should match");
  // sync
  await sync(originDir,"saveHashedRemote");
  
  //
  // 3) 別フォルダに clone
  //
  const cloneDir = asFilePath(fs.mkdtempSync(path.join(testdir, "clone-")));
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
  const secondTree = await getCurrentTreeHash(cloneDir);
  console.log("secondTree",secondTree);
  //assert.ok(isHash(secondTree), "second commit should exist");
  assert.equal(secondTree,"8c2151c1341ae06d3cd449a34ad26c96d2bfe0f2","second tree hash should match");

  const sync_clonef=new SyncFactory(asFilePath(path.join(cloneDir,GIT_DIR_NAME)));
  const sync_clone=await sync_clonef.load();
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
  await test_scenario_merge(originDir, cloneDir);
}
export async function test_scenario_merge(originDir:FilePath, cloneDir:FilePath) { 
  write(path.join(originDir, "a.txt"), "from origin");
  write(path.join(cloneDir, "b.txt"), "from cloned");
  assert.equal(
    fs.readFileSync(path.join(originDir, "a.txt"), "utf8"),
    "from origin"
  );
  assert.equal(
    fs.readFileSync(path.join(cloneDir, "b.txt"), "utf8"),
    "from cloned"   
  );
  const thirdCommit_o = await syncWithRetry(originDir, "saveHashedRemote");
  const thirdTree_o = await getCurrentTreeHash(originDir);
  console.log("thirdTree_o",thirdTree_o);
  assert.equal(thirdTree_o,"022aea6b51dba69b72294b89b3b6ebb506441d78","third tree(of origin) hash should match");
  const thirdCommit_c = await syncWithRetry(cloneDir, "saveHashedRemote");
  const thirdTree_c = await getCurrentTreeHash(cloneDir);
  assert.equal(thirdTree_c,"81add420c8ea9308bc16fc510790489fa408097c","third tree(of clone) hash should match");
  console.log("thirdTree_c",thirdTree_c);

  assert.equal(
    fs.readFileSync(path.join(cloneDir, "a.txt"), "utf8"),
    "from origin"
  );  
  

  const fourthCommit_o = await syncWithRetry(originDir, "saveHashedRemote");
  const fourthTree_o = await getCurrentTreeHash(originDir);
  console.log("fourthTree_o",fourthTree_o);
  assert.equal(fourthTree_o,thirdTree_c,"third tree(of object) and 4th hash should match");
  assert.equal(
    fs.readFileSync(path.join(originDir, "b.txt"), "utf8"),
    "from cloned"   
  );


}
export async function main(){
  await test_scenario_basic_sync();
  console.log("Cleanup");
  for (let f of cleanups) await f();
  console.log("All test passed.");
}
main();