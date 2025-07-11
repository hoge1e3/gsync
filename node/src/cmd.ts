import path from "path";
import { Repo, stripCR } from "./git.js";
import { Config, GIT_DIR_NAME, Sync } from "./sync.js";
import { asBranchName, asFilePath, asHash, asLocalRef, asPathInRepo, Author, BranchName, FilePath, Hash } from "./types.js";
import fs from "fs";

export async function main(cwd=process.cwd(), argv=process.argv) {
    // 1st command line arg is either clone commit sync
    // call corresponding function
    const [,, command, ...args] = argv;
    // pass current working directory as first argument
    //const cwd = process.cwd();
    switch (command) {
        case "clone":
            if (args.length<2) {
                console.log(argv.join(" ")+" <serverUrl> <repoId>");
                return;
            }
            const b=args[2]||"main";
            await clone(cwd, args[0], args[1],b);
            break;
        case "init":
            if (args.length<1) {
                console.log(argv.join(" ")+" <serverUrl>");
                return;
            }
            const serverUrl=args[0];
            await init(serverUrl);
            break;
        case "commit":
            await commit(cwd);
            break;
        case "sync":
        case undefined:
            await sync(cwd);
            break;
        case "log":
            await log(cwd);
            break;
        case "cat-file":
            await catFile(cwd, args[0]);
            break;
        default:
            throw new Error(`Unknown command: ${command}`);
    }
}
export async function catFile(dir: string, hash: string ) {
    const repo=new Repo(findGitDir(asFilePath(dir)));
    const obj=await repo.readObject(asHash(hash));
    if (!obj) {
        console.log("No such object: ", hash);
        return;
    }
    console.log("Type: ", obj.type);
    console.log("Content: ");
    console.log(obj.content.toString());
    
}
export async function init(serverUrl: string, gitDirName=GIT_DIR_NAME) {
    if (!serverUrl.endsWith(".php") && !serverUrl.endsWith("/")){
        console.warn(`${serverUrl} should be ends with .php or / `);
    }
    const gitDir=asFilePath(gitDirName);
    const sync=new Sync(gitDir);
    const repoId=await sync.init(serverUrl);
    console.log("Initialized new repository with id: ", repoId);
    const repo=new Repo(gitDir);
    repo.setCurrentBranchName(asBranchName("main"));
    return repoId;
}
export async function clone(into:string,    serverUrl: string, repoId: string, branch="main") {
    await _clone(asFilePath(into), {serverUrl,repoId} , asBranchName(branch) );
}

async function _clone(into:FilePath, config:Config,  branch: BranchName, gitDirName=GIT_DIR_NAME) {
    if (fs.existsSync(into) && fs.readdirSync(into).length>0) {
        throw new Error(`${into} is not empty.`);
    }
    console.log(`Cloning into ${into}...`);
    if (!fs.existsSync(into)) fs.mkdirSync(into);
    const newGitDir=asFilePath(path.join(into,gitDirName));
    fs.mkdirSync(newGitDir);
    const newSync=new Sync(newGitDir);
    const repo=new Repo(newGitDir);
    await newSync.writeConfig(config);
    await newSync.downloadObjects();
    const headCommitHash=await newSync.getRemoteHead(branch);
    repo.updateHead(asLocalRef(branch), headCommitHash );
    const headCommit=await repo.readCommit(headCommitHash);
    await repo.checkoutTreeToDir(headCommit.tree, into);
    await repo.setCurrentBranchName(branch);
    return newSync;

}
export function findGitDir(cwd: FilePath):FilePath {
    let c=cwd as string;
    while(true) {
        const res=path.join(c,GIT_DIR_NAME);
        if (fs.existsSync(res)) return asFilePath(res);
        const nc=path.dirname(c);
        if (!nc || nc===c) throw new Error(`No git repo found from ${cwd}`);
        c=nc;
    }
}
export async function commit(dir: string):Promise<Hash> {
    const repo=new Repo(findGitDir(asFilePath(dir)));
    if (!fs.existsSync(repo.headPath())) {
        await repo.setCurrentBranchName(asBranchName("main"));
    }
    const branch=await repo.getCurrentBranchName();
    const ref=asLocalRef(branch);
    const tree=await repo.buildTreeFromWorkingDir();
    const curCommitHash = await repo.readHead(ref);
    console.log("curCommitHash", curCommitHash);
    const curCommit = curCommitHash ? await repo.readCommit(curCommitHash) : null;
    const newCommitTreeHash=await repo.writeTree(tree);
    console.log("newCommitTreeHash", newCommitTreeHash);
    const MERGE_HEAD=await repo.readMergeHead();
    if (!MERGE_HEAD && curCommit && curCommit.tree===newCommitTreeHash) {
        console.log(branch,": Nothing changed");
        return curCommitHash!;
    }
    const newCommitHash=await repo.writeCommit({
        author: new Author("test","test@example.com"),
        committer: new Author("test","test@example.com"),
        parents: [...curCommitHash?[curCommitHash]:[], ...MERGE_HEAD? [MERGE_HEAD]:[]],
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
    const gitDir = findGitDir(asFilePath(dir));
    const sync=new Sync(gitDir);
    const repo=new Repo(gitDir);
    const branch=await repo.getCurrentBranchName();
    if (!await sync.hasRemoteHead(branch)) {
        // push to remote(new)
        await sync.uploadObjects();
        console.log("Push ",branch, " into ", localCommitHash);
        await sync.addRemoteHead(branch, localCommitHash);
        return ;
    }
    const remoteCommitHash=await sync.getRemoteHead(branch);
    await sync.downloadObjects();
    const baseCommitHash=await repo.findMergeBase(localCommitHash, remoteCommitHash);
    if (remoteCommitHash===baseCommitHash) {
        // update remote
        if (localCommitHash===remoteCommitHash) {
            console.log("Remote is up-to-date: ",localCommitHash);
            return;
        }
        await sync.uploadObjects();
        console.log("Push into remote: ",remoteCommitHash, " to ",localCommitHash);
        await sync.setRemoteHead(branch, remoteCommitHash, localCommitHash);
        return ;
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
        console.log("Merged commit hash: ",mergedCommitHash);
        console.log("Run sync again to push merged commit");       
    } else {
        let confc=0;
        for (let c of conflicts) {
            const obj=await repo.readObject(c.b);
            const postfix=`(${remoteCommitHash.substring(0,8)})`;
            const oldPath = repo.toFilePath(c.path);
            const oldContent = fs.readFileSync(oldPath);
            const newPath = makePostfix(oldPath, postfix);
            if (isConflicting(oldContent, obj.content)) {
                confc++;
                if (confc==1) console.log("CONFLICT");
                console.log(`Conflict saved at ${newPath}`);
                fs.writeFileSync(newPath, obj.content);
            }
        }
        if (confc>0) console.log("Resolve conflicts and run sync again");
        else {
            console.log("Auto-Merged from ",remoteCommit);
            const mergedCommitHash=await commit(dir);
            console.log("Merged commit hash: ",mergedCommitHash);
            console.log("Run sync again to push merged commit");       
        }
    }
}
function isConflicting(a:Buffer, b:Buffer) {
    const sa=stripCR(a);
    const sb=stripCR(b);
    if (sa.byteLength!==sb.byteLength) return true;
    for (let i=0;i<sa.byteLength;i++) if (sa[i]!==sb[i]) return true;
    return false; 
}
function makePostfix<T extends string>(filepath:T, postfix:string):T {
    // ex: filepath = "/a/b/test.txt"  postfix = "(1)"
    //       returns "/a/b/test(1).txt"
    //     filepath may either absolute or relative path
    const ext = path.extname(filepath);
    const basename = path.basename(filepath, ext);
    const dirname = path.dirname(filepath);
    const newBasename = `${basename}${postfix}${ext}`;
    return path.join(dirname, newBasename) as T;
}
export async function log(dir: string) {
    
    const gitDir = findGitDir(asFilePath(dir));
    const repo=new Repo(gitDir);
    const b=await repo.getCurrentBranchName();
    let ch=await repo.readHead(asLocalRef(b));
    while (ch) {
        const c=await repo.readCommit(ch);
        console.log(ch, c);
        ch=c.parents[0];
        if (c.parents[1]) console.log("Skipped merge commit: ",c.parents[1]);
    }
}

