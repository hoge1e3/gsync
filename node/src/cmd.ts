import * as path from "path";
import { Repo, sameExceptCRLF } from "./git.js";
import { DownloadableObjectStore, GIT_DIR_NAME, Sync, SyncFactory } from "./sync.js";
import { APIConfig, asBranchName, asFilePath, asHash, asLocalRef, asPathInRepo, Author, BranchName, FilePath, Hash, SyncStatus, Conflicted, CloneOptions, ConflictResolutionPolicy, IgnoreState } from "./types.js";
import * as fs from "fs";
import { factory as offlineObjectStoreFactory} from "./objects.js";

export async function main(cwd=process.cwd(), argv=process.argv):Promise<any> {
    // 1st command line arg is either clone commit sync
    // call corresponding function
    const [,, command, ...args] = argv;
    // pass current working directory as first argument
    //const cwd = process.cwd();
    switch (command) {
        case "clone":
        case "clone_overwrite":
        case "clone_nocheckout":
            if (args.length<2) {
                console.log(argv.join(" ")+" <serverUrl> <repoId>");
                return;
            }
            const b=args[2]||"main";
            if (command==="clone") {
                return await clone(cwd, args[0], args[1],b);
            } else if(command==="clone_nocheckout") {
                return await clone(cwd, args[0], args[1],b, {gitDirName:GIT_DIR_NAME, allowNonEmpty:"skipCheckout"});
            } else {
                return await clone(cwd, args[0], args[1],b, {gitDirName:GIT_DIR_NAME, allowNonEmpty:"overwrite"});
            }
        case "init":
            if (args.length<1) {
                console.log(argv.join(" ")+" <serverUrl>");
                return;
            }
            const serverUrl=args[0];
            return await init(cwd, serverUrl, GIT_DIR_NAME);
        case "commit":
            return await commit(cwd);
        case "sync":
        case undefined:
            return await syncWithRetry(cwd, "saveHashedRemote");
        case "newer":
            return await syncWithRetry(cwd, "newer");
        case "log":
            return await log(cwd);
        case "cat-file":
            return await catFile(cwd, args[0]);
        //case "download-objects":
        //    return await downloadObjects(cwd, args.includes("-a")?"all":"max_mtime");
        case "manage":
            return await manage(cwd);
        case "scan":
            return await scan(cwd, 
            args.includes("--id"), 
            args.includes("--url"), 
            args.includes("--key"),
            args.includes("--shell"),
            );
        default:
            throw new Error(`Unknown command: ${command}`);
    }
}
export async function scan(cwd:string, 
showRepo:boolean, showUrl:boolean, 
showKey:boolean,shell:boolean){
    const name=GIT_DIR_NAME;
    // scan recursively *cwd* and list folder named *name*
    function scanDir(dir:string) {
        let results:string[]=[];
        const files=fs.readdirSync(dir);
        for (let f of files) {
            const fullpath=path.join(dir,f);
            if (fs.statSync(fullpath).isDirectory()) {
                if (f===name) {
                    results.push(dir);
                } else {
                    results=results.concat(scanDir(fullpath));
                }
            }
        }
        return results;
    }
    for (let d of scanDir(cwd)){
      if(shell){
        console.log("cd",d,";gsync");
        continue;
      }
        const field=[d];
        if (showKey || showRepo || showUrl) {
            const gitDir=asFilePath(path.join(d, GIT_DIR_NAME));
            const syncf=new SyncFactory(gitDir);
            const conf=await syncf.readConfig();
            if (showUrl) field.push(conf.serverUrl);
            if (showRepo) field.push(conf.repoId);
            if (showKey) field.push(conf.apiKey);
        }
        console.log(...field);
    }
}
export async function manage(cwd:string, gitDirName=GIT_DIR_NAME) {
    const dir=path.join(cwd, gitDirName);
    const gitDir=asFilePath(dir);
    const syncf=new SyncFactory(gitDir);
    const conf=await syncf.readConfig();
    const repoId=conf.repoId;
    const url=conf.serverUrl;
    const manage=
        url.match  (/\w+.php$/)?
        url.replace(/\w+.php$/,"manage.php"):
        url+"manage.php";
    console.log(`Open ${manage}?repo=${repoId}`);
}
async function offlineRepo(gitDir:FilePath) {
    const objectStore=await offlineObjectStoreFactory(gitDir);
    const repo=new Repo(gitDir,objectStore);
    return repo;
}
export async function catFile(dir: string, hash: string ) {
    const gitDir=findGitDir(asFilePath(dir));
    const repo=await offlineRepo(gitDir);
    const obj=await repo.readObject(asHash(hash));
    if (!obj) {
        console.log("No such object: ", hash);
        return;
    }
    console.log("Type: ", obj.type);
    console.log("Content: ");
    console.log(obj.content.toString());
    
}
export async function init(cwd: string, serverUrl: string, gitDirName=GIT_DIR_NAME) {
    const dir=path.join(cwd, gitDirName);
    if (!serverUrl.endsWith(".php") && !serverUrl.endsWith("/")){
        console.warn(`WARNING! ${serverUrl} should be ends with .php or / `);
    }
    const gitDir=asFilePath(dir);
    const syncf=new SyncFactory(gitDir);
    const sync=await syncf.init(serverUrl);
    const repoId=sync.webapi.config.repoId;
    console.log("Initialized new repository with id: ", repoId);
    const repo=sync.repo;//new Repo(gitDir);
    repo.setCurrentBranchName(asBranchName("main"));
    return repoId;
}
export async function clone(into:string,    serverUrl: string, repoId: string, branch="main", options:CloneOptions={gitDirName:GIT_DIR_NAME}) {
    await _clone(asFilePath(into), {serverUrl,repoId,apiKey:Math.random().toString(36).slice(2)} , asBranchName(branch), options );
}

async function _clone(into:FilePath, config:APIConfig,  branch: BranchName, options: CloneOptions) {
    let skipco;
    if (fs.existsSync(into) && fs.readdirSync(into).length>0) {
        if (!options.allowNonEmpty) throw new Error(`${into} is not empty.`);
        skipco=(options.allowNonEmpty==="skipCheckout");
    }
    console.log(`Cloning into ${into}...`);
    if (!fs.existsSync(into)) fs.mkdirSync(into);
    const newGitDir=asFilePath(path.join(into, options.gitDirName));
    fs.mkdirSync(newGitDir);
    const newSyncf=new SyncFactory(newGitDir);
    await newSyncf.writeConfig(config);
    const newSync=await newSyncf.load();
    const repo=newSync.repo;//new Repo(newGitDir);
    //await newSync.downloadObjects();
    const headCommitHash=await newSync.getRemoteHead(branch);
    repo.updateHead(asLocalRef(branch), headCommitHash );
    if (!skipco) {
        const headCommit=await repo.readCommit(headCommitHash);
        await repo.checkoutTreeToDir(headCommit.tree, into);
    }
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
    const gitDir = findGitDir(asFilePath(dir));
    // even commit is failed unless online 
    const syncf=new SyncFactory(gitDir);
    const sync=await syncf.load();
    const repo=sync.repo;
    if (!fs.existsSync(repo.headPath())) {
        await repo.setCurrentBranchName(asBranchName("main"));
    }
    const branch=await repo.getCurrentBranchName();
    const ref=asLocalRef(branch);
    const tree=await repo.buildTreeFromWorkingDir();
    const curCommitHash = await repo.readHead(ref);
    console.log("curCommitHash", curCommitHash);
    // even commit is failed unless online 
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
export async function syncWithRetry(dir: string, 
    conflictResolutionPolicy:ConflictResolutionPolicy): Promise<SyncStatus> {
    const res=[];
    for(let i=0;i<5;i++) {
        let r=await sync(dir, conflictResolutionPolicy);
        res.push(r);
        if (r!=="auto_merged") {
            // auto_merged->pushed
            if(res.includes("auto_merged")) return "auto_merged"; 
            else return r;
        }
    }
    throw new Error("Auto-merge repeated 5 times. Aborted.");
}
/*export async function downloadObjects(dir:string, ignoreState:IgnoreState) {
    const gitDir = findGitDir(asFilePath(dir));
    const sync=new Sync(gitDir);
    await sync.downloadObjects(ignoreState);
}*/
export async function sync(dir: string, 
    conflictResolutionPolicy:ConflictResolutionPolicy):Promise<SyncStatus> {

    const localCommitHash=await commit(dir);
    const gitDir = findGitDir(asFilePath(dir));
    const syncf=new SyncFactory(gitDir);
    const sync=await syncf.load();
    const repo=sync.repo;//new Repo(gitDir);
    const branch=await repo.getCurrentBranchName();
    if (!await sync.hasRemoteHead(branch)) {
        // push to remote(new)
        await sync.uploadObjects();
        console.log("Push ",branch, " into ", localCommitHash);
        await sync.addRemoteHead(branch, localCommitHash);
        return "newly_pushed";
    }
    const remoteCommitHash=await sync.getRemoteHead(branch);
    //await sync.downloadObjects();
    const baseCommitHash=await repo.findMergeBase(localCommitHash, remoteCommitHash);
    if (remoteCommitHash===baseCommitHash) {
        // update remote
        if (localCommitHash===remoteCommitHash) {
            console.log("Remote is up-to-date: ",localCommitHash);
            return "no_changes";
        }
        await sync.uploadObjects();
        console.log("Push into remote: ",remoteCommitHash, " to ",localCommitHash);
        await sync.setRemoteHead(branch, remoteCommitHash, localCommitHash);
        return "pushed";
    }
    const localCommit=await repo.readCommit(localCommitHash);
    const remoteCommit=await repo.readCommit(remoteCommitHash);
    const remoteCommitTime=remoteCommit.author.date;
    const localTree=await repo.readTree(localCommit.tree);
    const remoteTree=await repo.readTree(remoteCommit.tree);
    if (localCommitHash===baseCommitHash) {
        // update local
        const diff=await repo.diffTreeRecursive(localTree, remoteTree)
        await repo.applyDiff(diff);
        await repo.updateHead(asLocalRef(branch), remoteCommitHash);
        console.log("Update local branch", localCommitHash, "to" ,remoteCommitHash);
        return "pulled";
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
        return "auto_merged"; 
    } else {
        let confpaths:Conflicted=[];
        for (let c of conflicts) {
            const remoteObj=await repo.readObject(c.b);
            const localPath = repo.toFilePath(c.path);
            const localContent = fs.readFileSync(localPath);
            if (!sameExceptCRLF(localContent, remoteObj.content)) {
                const winner = 
                    conflictResolutionPolicy==="ignoreLocal"? "remote":
                    conflictResolutionPolicy==="ignoreRemote"? "local":
                    conflictResolutionPolicy==="newer"?
                        (remoteCommitTime.getTime()>
                        fs.statSync(localPath).mtime.getTime()?"remote":"local"):
                    null;
                if (winner===null) {
                    const postfix=`(${remoteCommitHash.substring(0,8)})`;
                    const postfixedPath = makePostfix(localPath, postfix);
                    confpaths.push(repo.toPathInRepo(postfixedPath));
                    if (confpaths.length==1) console.log("CONFLICT");
                    console.log(`Conflict saved at ${postfixedPath}`);
                    fs.writeFileSync(postfixedPath, remoteObj.content);
                } else if (winner==="remote") {
                    console.log(`Overwrite ${localPath}`); 
                    fs.writeFileSync(localPath, remoteObj.content);
                } else {
                    console.log(`Skip ${localPath}`); 
                }
            }
        }
        if (confpaths.length>0) {
            console.log("Resolve conflicts and run sync again");
            return confpaths;
        } else {
            console.log("Auto-Merged from ",remoteCommit);
            const mergedCommitHash=await commit(dir);
            console.log("Merged commit hash: ",mergedCommitHash);
            console.log("Run sync again to push merged commit");       
            return "auto_merged"; 
        }
    }
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
    const repo=await offlineRepo(gitDir);
    const b=await repo.getCurrentBranchName();
    let ch=await repo.readHead(asLocalRef(b));
    while (ch) {
        const c=await repo.readCommit(ch);
        console.log(ch, c);
        ch=c.parents[0];
        if (c.parents[1]) console.log("Skipped merge commit: ",c.parents[1]);
    }
}

