import { asPath, Author, Hash, RelPath, TreeEntry, asLocalRef, asBranchName} from "../src/types.js";
import * as assert from "assert";
import { Repo } from "../src/git.js";
import { Sync } from "../src/sync.js";
import { clone, commit, log, sync } from "../src/cmd.js";
const branch_main = asBranchName("main");
const localRef_main = asLocalRef(branch_main);
/*
export async function testCommit(){
    const repo=new Repo(asPath(".git"));
    //const obj=await repo.readObject("00d6602b2832d060ad2a2f26c4b5bd957aa2dde8");
    //console.log(obj.type, obj.content);
    const curCommitHash=await repo.readHead(localRef_main);
    console.log(curCommitHash);
    const curCommit=await repo.readCommit(curCommitHash);
    console.log(curCommit);
    const curTree=await repo.readTree(curCommit.tree);
    console.log(curTree);
    console.log("---last commit ---");
    for await (let e of repo.traverseTree(curTree)) {
        console.log(e.path, e.hash, await newLineType(e.path, e.hash));
        
    }
    console.log("---current working dir ---");
    const bt=await repo.buildTreeFromWorkingDir();
    for await (let e of repo.traverseTree(bt)) {
        console.log(e.path, e.hash, await newLineType(e.path, e.hash));
    }
    const newCommitTreeHash=await repo.writeTree(bt);
    const newCommitHash=await repo.writeCommit({
        author: new Author("hoge1e3","test@example.com"),
        committer: new Author("hoge1e3","test@example.com"),
        parents: [curCommitHash],
        message: "Change test-git.js",
        tree: newCommitTreeHash
    });
    await repo.updateHead(localRef_main, newCommitHash);

    async function newLineType(path:RelPath, hash:Hash) {
        if (path.match(/\.(js|ts|json)$/)) {
            const text=await repo.readBlobAsText(hash);
            if (text.includes("\r\n")) return ("CR+LF");
            else if (text.includes("\n")) return ("LF");
            return "Oneline";
        } 
        return "bin";
    }
}    
async function testMerge() {
    const repo=new Repo(asPath(".git"));
    const mainCommitHash=await repo.readHead(localRef_main);
    const mainCommit=await repo.readCommit(mainCommitHash);
    const branchCommitHash=await repo.readHead(asLocalRef(asBranchName("branch1")));
    const branchCommit=await repo.readCommit(branchCommitHash);
    
}
async function testSync_push() {
    const sync=new Sync(asPath(".git"));
    await sync.uploadObjects();
    await sync.pushHead(branch_main);
}
async function testSync_fetch() {
    const sync=new Sync(asPath("js/test/fixture/dotgit"));
    await sync.downloadObjects();
    await sync.fetchHead(branch_main);

}*/
async function test_clone(name="clonetes") {
    const repo=new Sync(asPath("js/test/fixture/dotgit"));
    /*await Sync.clone(asPath("js/test/fixture/clonetes"), await repo.readConfig() , branch_main );
    */
   const conf=await repo.readConfig();
   await clone("js/test/fixture/"+name, conf.serverUrl, conf.repoId);
}
async function test_commit(name="clonetes") {
    await commit("js/test/fixture/"+name);
}
async function test_sync(name="clonetes") {
    await sync("js/test/fixture/"+name);
}
async function main() {
    //await test_clone();
    //await test_commit();
    //await test_sync();
    //await test_clone("clonetes2");
    //await test_commit("clonetes2");
    //await test_sync("clonetes2");
    
    await test_sync();
    
    //await log("js/test/fixture/clonetes");
}
main();

//main();
/*
get committer times: parse commit time and parents for e28d7596fe348f27bfa19c67921daa3a601059be: parse 'committer' header: find email terminator in 'hoge1e3'
*/