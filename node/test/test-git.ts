import { Author, Hash, TreeEntry, asLocalRef, asBranchName, asHash, ObjectType, FilePath, asFilePath} from "../src/types.js";
import * as assert from "assert";
import { RecursiveGitIgnore, Repo } from "../src/git.js";
import { Sync } from "../src/sync.js";
import { clone, commit, log, sync } from "../src/cmd.js";
import { sha1Hex } from "../src/codec.js";
import _crypto from 'crypto';
const branch_main = asBranchName("main");
const localRef_main = asLocalRef(branch_main);
import * as path from "path";
import * as fs from "fs";
import { FileBasedObjectStore, ObjectEntry } from "../src/objects.js";
export async function testHash2(){
    const repo=new Repo(asFilePath("../.gsync"));
    const ig=new RecursiveGitIgnore();
    const walk=(dir:FilePath)=>{
        ig.push(dir);
        //console.log("ig",ig);
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
            const fullPath = asFilePath(path.join(dir, file.name));
            if (ig.ignores(fullPath)||file.name===(".git")) {
                console.log("Ignores" ,fullPath);
                continue;
            }
            if (file.name==="node_modules") {
                console.log(ig.stack);
                throw new Error("node!!");
            }
            if (fs.statSync(fullPath).isDirectory()){
                walk(fullPath);
            } else {
                console.log(fullPath);
            }
        }
        ig.pop();
    };
    walk(asFilePath(path.dirname(repo.gitDir)));
    return;

    const obj1=await repo.readObject(asHash("4b4a31ee8f73a2aad9045b32e996a5762e575982"));
    const obj2=await repo.readObject(asHash("eca5de281828d1b28e39f8866464003d3a7c7f4f"));


    const b1=obj1.content;
    const hash1=await _crypto.createHash('sha1').update(b1).digest('hex');
    const hashBuffer = await crypto.subtle.digest('SHA-1', new Uint8Array(b1).buffer);
    const hash2= [...new Uint8Array(hashBuffer)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    console.log(hash1, hash2);
    return;
    const b2=obj2.content;
    console.log(b1.length,b2.length);
    for (let i=0;i<b1.length;i++) {
        if (b1[i]!==b2[i]) console.log(i, b1[i],b2[i]);
    }
    const h1=await repo.writeObject("blob", b1);
    const h2=await repo.writeObject("blob", b2);
    const h3=await repo.writeObject("blob", b1);
    const h4=await repo.writeObject("blob", b2);
    /*const h1=await sha1Hex(new Uint8Array(b1));
    const h2=await sha1Hex(new Uint8Array(b2));*/
    console.log(h1, h2, h3, h4);
}
async function writeObject(type: ObjectType, content: Buffer): Promise<Hash> {
    const header = `${type} ${content.length}\0`;
    const store = Buffer.concat([Buffer.from(header), content]);
    console.log(store);
    const hash = asHash( await sha1Hex(new Uint8Array(store)));
    return hash;
}
export async function testHash(){
    const repo=new Repo(asFilePath(".git"));
    //const obj=await repo.readObject("00d6602b2832d060ad2a2f26c4b5bd957aa2dde8");
    //console.log(obj.type, obj.content);
    const curCommitHash=await repo.readHead(localRef_main);
    console.log(curCommitHash);
    const curCommit=curCommitHash? await repo.readCommit(curCommitHash):null;
    console.log(curCommit);
    if (!curCommit) return;
    const curTree=await repo.readTree(curCommit.tree);
    console.log(curTree);
    console.log("---last commit ---");
    for await (let e of repo.traverseTree(curTree)) {
        console.log(e.path, e.hash, await newLineType(repo.toFilePath(e.path), e.hash));        
    }
    async function newLineType(path:FilePath, hash:Hash) {
        if (path.match(/\.(js|ts|json)$/)) {
            const text=await repo.readBlobAsText(hash);
            if (text.includes("\r\n")) return ("CR+LF");
            else if (text.includes("\n")) return ("LF");
            return "Oneline";
        } 
        return "bin";
    }
}
/*
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
    const repo=new Sync(asFilePath("js/test/fixture/dotgit"));
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
async function testObjectStore(){
    const since1=new Date();
    const s=new FileBasedObjectStore(asFilePath("../cotest/.gsync/objects"));
    const all:ObjectEntry[]=[];
    for await (let e of s.iterate(new Date(0))) {
        all.push(e);
    }
    all.sort((a,b)=>b.mtime.getTime()-a.mtime.getTime());
    for (let e of all) {
        console.log(e.hash, e.content.byteLength, e.mtime);
    }
    const d=all[10].mtime;
    console.log("----",d);
    for await (let e of s.iterate(d)) {
        console.log("iter1", e.hash, e.content.byteLength, e.mtime);
    }
    const s2=new FileBasedObjectStore(asFilePath("../cotest/.gsync/objects2"));
    s2.put(all[0].hash, all[0].content);
    const val=await s2.get(all[0].hash);
    const c=val.content;
    if (c.byteLength!==all[0].content.byteLength){
        throw new Error("Not match");
    }
    for (let i=0;i<c.byteLength;i++) {
        if (c[i]!==all[0].content[i]) {
            throw new Error("Not match "+i);
        }
    }
    console.log(await s2.has(all[0].hash));
    console.log(await s2.has(asHash("0cd7fb5fabbf420a4256e6b86b6825d6da2f602c")));
    const since2=new Date();
    for await (let e of s2.iterate(since1)) {
        console.log("iter2-1", since1, e.hash, e.content.byteLength, e.mtime);
    }
    for await (let e of s2.iterate(since2)) {
        console.log("iter2-2", since2, e.hash, e.content.byteLength, e.mtime);
    }
}
async function main() {
    await testObjectStore();
    //await test_clone();
    //await testHash2();
    //await test_sync();
    //await test_clone("clonetes2");
    //await test_commit("clonetes2");
    //await test_sync("clonetes2");
    
    //await test_sync();
    
    //await log("js/test/fixture/clonetes");
}
main();

//main();
/*
get committer times: parse commit time and parents for e28d7596fe348f27bfa19c67921daa3a601059be: parse 'committer' header: find email terminator in 'hoge1e3'
*/