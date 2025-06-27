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
    //const repo=sync.repo;
    const branch=await repo.getCurrentBranchName();
    const remoteCommitHash=await sync.fetchHead(branch);
    const baseCommitHash=await repo.findMergeBase(localCommitHash, remoteCommitHash);
    if (remoteCommitHash===baseCommitHash) {
        // update remote
        await sync.uploadObjects();
        console.log("Push into remote: ",remoteCommitHash, " to ",localCommitHash);
        //console.log("Push into remote: ",remoteCommitHash, " to ",localCommitHash);
        const status=await sync.setRemoteHead(branch, remoteCommitHash, localCommitHash);
        if (status==null) {
            console.log("Pushed");
        } else {
            console.log("Remote commit id changed into ",status, "try again");
        }
        return ;        return ;
    }
    const localCommit=await repo.readCommit(localCommitHash);
    const remoteCommit=await repo.readCommit(remoteCommitHash);
    const localTree=await repo.readTree(localCommit.tree);
    const remoteTree=await repo.readTree(remoteCommit.tree);
    if (localCommitHash===baseCommitHash) {
        // update local
        const diff=await repo.diffTreeRecursive(localTree, remoteTree)
        await repo.applyDiff(diff);
        await repo.updateHead(asLocalRef(branch), remoteCommitHash);
        console.log("Update local branch", localCommitHash, "to" ,remoteCommitHash);
        return;
    }   
    const baseCommit=await repo.readCommit(baseCommitHash);
    const baseTree=await repo.readTree(baseCommit.tree);
    const {toA, toB, conflicts}=await repo.threeWayMerge(baseTree, localTree, remoteTree);
    await repo.writeMergeHead(remoteCommitHash);
    await repo.applyDiff(toA);
    if (conflicts.length==0) {
        console.log("Auto-Merged from ",remoteCommit);
        const mergedCommitHash=await commit(dir);
        // update remote
        console.log("Push into remote: ",remoteCommitHash, " to ",mergedCommitHash);
        const status=await sync.setRemoteHead(branch, remoteCommit, mergedCommitHash);
        if (status==null) {
            console.log("Pushed");
        } else {
            console.log("Remote commit id changed into ",status, "try again");
        }
        return ;
    } else {
        console.log("CONFLICT");

    }
}
