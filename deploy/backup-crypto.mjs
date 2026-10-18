// Versioned streaming AES-256-GCM envelope. Keys are binary 32-byte files,
// never environment values, command-line secrets, logs or backup metadata.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, statSync, openSync, readSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
const magic=Buffer.from('TDBACKUP1\n');
export async function encryptBackup(input, output, keyFile) {
  const key=readFileSync(keyFile);if(key.length!==32)throw new Error('Backup key must contain exactly 32 random bytes.');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(magic);
  const temporary=output+`.${randomBytes(6).toString('hex')}.tmp`;
  const dest=createWriteStream(temporary,{flags:'wx',mode:0o600});
  try {
    dest.write(Buffer.concat([magic,nonce]));
    await pipeline(createReadStream(input),cipher,dest,{end:false});
    await new Promise((resolve,reject)=>{dest.once('error',reject);dest.end(cipher.getAuthTag(),resolve);});
    renameSync(temporary,output);
  }catch(e){dest.destroy();try{unlinkSync(temporary);}catch{}throw e;}
  finally{key.fill(0);}
}
export async function decryptBackup(input, output, keyFile) {
  const key=readFileSync(keyFile);if(key.length!==32)throw new Error('Backup key must contain exactly 32 random bytes.');
  const length=statSync(input).size,header=Buffer.alloc(magic.length+12),tag=Buffer.alloc(16),fd=openSync(input,'r');
  try{readSync(fd,header,0,header.length,0);readSync(fd,tag,0,16,length-16);}finally{closeSync(fd);}
  if(length<header.length+16||!header.subarray(0,magic.length).equals(magic))throw new Error('Invalid backup envelope.');
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(magic.length));decipher.setAAD(magic);decipher.setAuthTag(tag);
  // Never publish partially decrypted data before the authentication tag verifies.
  const temporary=output+`.${randomBytes(6).toString('hex')}.tmp`;
  try{await pipeline(createReadStream(input,{start:header.length,end:length-17}),decipher,createWriteStream(temporary,{flags:'wx',mode:0o600}));renameSync(temporary,output);}
  catch(e){try{unlinkSync(temporary);}catch{}throw e;}finally{key.fill(0);}
}
if(process.argv[1]?.endsWith('backup-crypto.mjs')) {
  const [mode,input,output,keyFile]=process.argv.slice(2);
  if(!['encrypt','decrypt'].includes(mode)||!input||!output||!keyFile)throw new Error('Usage: node backup-crypto.mjs encrypt|decrypt INPUT OUTPUT KEY_FILE');
  try{await(mode==='encrypt'?encryptBackup:decryptBackup)(input,output,keyFile);console.log('Backup encryption operation completed; no key material logged.');}
  catch{console.error('Backup encryption operation failed; details suppressed.');process.exitCode=1;}
}
