import path from "path";
import { Repo } from "./git";
import { GIT_DIR_NAME, Sync } from "./sync";
import { asBranchName, asLocalRef, asPath, Author, Hash, Path } from "./types";
import fs from "fs";

export async function clone(into:string,    serverUrl: string, repoId: string, branch="main") {
    await Sync.clone(asPath(into), {serverUrl,repoId} , asBranchName(branch) );
}
export function findGitDir(cwd: Path):Path {
    let c=cwd as string;
    while(true) {
        const res=path.join(c,GIT_DIR_NAME);
        if (fs.existsSync(res)) return asPath(res);
        const nc=path.dirname(c);
        if (!nc || nc===c) throw new Error(`No git repo found from ${cwd}`);
        c=nc;
    }
}
export async function commit(dir: string):Promise<Hash> {
    const repo=new Repo(findGitDir(asPath(dir)));
    const branch=await repo.getCurrentBranchName();
    const ref=asLocalRef(branch);
    const tree=await repo.buildTreeFromWorkingDir();
    const curCommitHash = await repo.readHead(ref);
    const curCommit = await repo.readCommit(curCommitHash);
    const newCommitTreeHash=await repo.writeTree(tree);
    if (curCommit.tree===newCommitTreeHash) {
        console.log(branch,": Nothing changed");
        return curCommitHash;
    }
    const MERGE_HEAD=await repo.readMergeHead();
    const newCommitHash=await repo.writeCommit({
        author: new Author("test","test@example.com"),
        committer: new Author("test","test@example.com"),
        parents: [curCommitHash, ...MERGE_HEAD? [MERGE_HEAD]:[]],
        message: new Date()+"",
        tree: newCommitTreeHash
    });
    if (MERGE_HEAD) await repo.writeMergeHead();
    console.log("New commit for", branch, ": ",newCommitHash);
    await repo.updateHead(ref, newCommitHash);
    return newCommitHash;
}
export async function sync(dir: string) {

    const localCommitHash=await commit(dir);
    const sync=new Sync(findGitDir(asPath(dir)));
    const repo=sync.repo;
    const branch=await repo.getCurrentBranchName();
    const remoteCommitHash=await sync.fetchHead(branch);
    const baseCommitHash=await repo.findMergeBase(localCommitHash, remoteCommitHash);
    if (remoteCommitHash===baseCommitHash) {
        // update remote
        console.log("Push into remote: ",remoteCommitHash, " to ",localCommitHash);
        await sync.pushHead(branch);
        return ;

    } else if (localCommitHash===baseCommitHash) {
        // update local

    }

    const localCommit=await repo.readCommit(localCommitHash);
    const remoteCommit=await repo.readCommit(remoteCommitHash);
    

    const localTree=await repo.readTree(localCommit.tree);
    const remoteTree=await repo.readTree(remoteCommit.tree);
    repo.threeWayMerge()
}
