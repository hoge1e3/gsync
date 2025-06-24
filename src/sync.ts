import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { config } from './config';
import { Hash, Path } from './types';

type Config={
    serverUrl: string,
    repoID: string,
};
type State={
    downloadSince: number,
    uploadSince: number,
};

async function readConfig(gitDir:Path) {

}
async function uploadObjects(since: number = 0): Promise<void> {
  const { gitDir, repoId, serverUrl } = config;
  const objectsDir = path.join(gitDir, 'objects');
  const objects: { hash: string; content: string }[] = [];

  const dirs = fs.readdirSync(objectsDir).filter(d => /^[0-9a-f]{2}$/.test(d));

  for (const dir of dirs) {
    const dirPath = path.join(objectsDir, dir);
    const files = fs.readdirSync(dirPath).filter(f => /^[0-9a-f]{38}$/.test(f));

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);

      if (stats.mtimeMs < since * 1000) continue; // 秒→ミリ秒で比較

      const hash = dir + file;
      const raw = fs.readFileSync(filePath);
      const content = raw.toString('base64');

      objects.push({ hash, content });
    }
  }

  if (objects.length === 0) {
    console.log('No new objects to upload.');
    return;
  }

  const res = await axios.post(`${serverUrl}?action=upload`, {
    repo_id: repoId,
    objects
  });

  console.log(`Uploaded ${objects.length} objects. Server timestamp:`, res.data.timestamp);
}


export async function downloadObjects(since: number = 0): Promise<void> {
  const { gitDir, repoId, serverUrl } = config;
  const objectsDir = path.join(gitDir, 'objects');

  const res = await axios.post(`${serverUrl}?action=download`, {
    repo_id: repoId,
    since
  });

  const objects: { hash: Hash; content: string }[] = res.data.objects;
  const newest=res.data.newest-0;

  for (const { hash, content } of objects) {
    const dir = hash.slice(0, 2);
    const file = hash.slice(2);
    const dirPath = path.join(objectsDir, dir);
    const filePath = path.join(dirPath, file);

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    if (!fs.existsSync(filePath)) {
      const binary = Buffer.from(content, 'base64');
      fs.writeFileSync(filePath, binary);
      console.log('Saved:', hash);
    } else {
      console.log('Skipped (exists):', hash);
    }
  }
}
/*
downloadObjects().catch(console.error);

uploadObjects().catch(console.error);
*/