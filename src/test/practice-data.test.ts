import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error static JS module
import * as store from '../../public/serve-coach/js/store.js';
// @ts-expect-error static JS module
import { buildClipAnalysis, frameMetrics, jointAngle } from '../../public/serve-coach/js/practice-data.js';
// @ts-expect-error static JS module
import { resolveServingArm } from '../../public/serve-coach/js/contact-analysis.js';

const frames = () => [[800,350,350,350],[700,350,350,350],[600,350,350,350],[500,350,350,350],
  [450,300,350,300],[430,290,350,300],[350,250,350,325],[350,200,350,300],
  [350,150,350,275],[360,220,355,310],[370,260,360,330],[410,330,380,350],[450,400,400,350]].map((m, n) => {
    const kp = Array<number>(51).fill(0);
    const set = (i: number, x: number, y: number) => { kp[i*3]=x/1000; kp[i*3+1]=y/1000; kp[i*3+2]=0.9; };
    set(0,300,250); set(5,250,400); set(6,350,400); set(11,250,600); set(12,350,600);
    set(7,250,230); set(9,250,60); set(10,m[0] ?? 0,m[1] ?? 0); set(8,m[2] ?? 0,m[3] ?? 0);
    return {t:n*100,kp};
  });

describe('versioned local practice data', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('serve-coach', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('sessions',{keyPath:'id'}).createIndex('createdAt','createdAt');
        const clips=db.createObjectStore('clips',{keyPath:'id'});
        clips.createIndex('sessionId','sessionId'); clips.createIndex('status','status');
        db.createObjectStore('chunks',{keyPath:['clipId','seq']});
        db.createObjectStore('poses',{keyPath:['clipId','seq']});
        db.createObjectStore('notes',{keyPath:'id'}).createIndex('sessionId','sessionId');
        const tx=request.transaction;
        if (!tx) throw new Error('Missing upgrade transaction');
        tx.objectStore('sessions').put({id:'legacy',createdAt:'2026-11-21T18:00:00Z',playerHand:'L',status:'ended'});
        tx.objectStore('clips').put({id:'legacy-clip',sessionId:'legacy',createdAt:'2026-11-21T18:00:00Z',seq:1,status:'saved',video:{durationMs:1200,mime:'video/webm',width:1000,height:1000}});
        tx.objectStore('poses').put({clipId:'legacy-clip',seq:0,frames:[{t:0,kp:null}]});
        // Binary fixture avoids jsdom Blob's missing structuredClone support in fake IndexedDB.
        tx.objectStore('chunks').put({clipId:'legacy-clip',seq:0,blob:new TextEncoder().encode('original video')});
        tx.objectStore('notes').put({id:'legacy-note',sessionId:'legacy',text:'My private note',createdAt:'2026-11-21T18:00:00Z'});
      };
      request.onsuccess=()=>{request.result.close();resolve();}; request.onerror=()=>reject(request.error);
    });
  });

  it('upgrades existing sessions without losing clips, frames or notes', async () => {
    const data=await store.getPracticeData('legacy');
    expect(data).toMatchObject({schemaVersion:3,date:'2026-11-21T18:00:00Z',dominantHand:'left',strokeType:'serve',recordingDurationMs:1200});
    expect(data.recordings).toEqual([expect.objectContaining({id:'legacy-clip',dominantHand:'left',poseFrames:[{t:0,kp:null}]})]);
    expect(data.notes).toEqual([expect.objectContaining({text:'My private note'})]);
    expect((await store.getClipVideo(data.recordings[0])).blob.size).toBe(14);
  });

  it('keeps captured hand and date after the preference changes', async () => {
    store.prefs.set(store.KEYS.profile,{hand:'R'});
    const session=await store.createSession();
    store.prefs.set(store.KEYS.profile,{hand:'L'});
    const clip=await store.createClip(session.id,{status:'saved',video:{durationMs:2100}});
    expect((await store.getSession(session.id)).dominantHand).toBe('right');
    expect(clip.dominantHand).toBe('right');
    expect(session.date).toBe(session.createdAt);
    expect(resolveServingArm(clip,session,{hand:'L'})).toBe('right');
    expect(resolveServingArm({}, {playerHand:'R'}, {hand:'L'})).toBe('right');
  });

  it('sums actual recording durations and updates the total after clip deletion', async () => {
    const session=await store.createSession();
    const a=await store.createClip(session.id,{status:'saved',video:{durationMs:1000}});
    const b=await store.createClip(session.id,{status:'saved',video:{durationMs:2000}});
    await store.updateClip(b.id,{video:{durationMs:2500}});
    expect((await store.getSession(session.id)).recordingDurationMs).toBe(3500);
    await store.deleteClip(a);
    expect((await store.getSession(session.id)).recordingDurationMs).toBe(2500);
    expect((await store.getClip(b.id)).recordingDurationMs).toBe(2500);
  });

  it('saves contact-local speed, joint angles, confidence and both clocks alongside raw poses', async () => {
    const session=await store.createSession(null,{playerHand:'R'});
    const clip=await store.createClip(session.id,{status:'saved',video:{durationMs:1200,width:1000,height:1000},sync:{offsetMs:-350,method:'measured'}});
    const raw=frames();
    await store.putPoses(clip.id,0,raw);
    const analysis=await store.finalizeClipData(clip.id);
    expect(analysis).toMatchObject({schemaVersion:1,clipId:clip.id,sessionId:session.id,strokeType:'serve',dominantHand:'right',handSource:'recorded',metrics:{contact:{timestampMs:1150,poseTimestampMs:800,elbowAngleDegrees:180,estimated:true}}});
    const expected=(50+50+Math.hypot(10,70))*0.0025/0.1/3;
    expect(analysis.metrics.swingSpeed.handMph).toBeCloseTo(expected*2.237,8);
    expect(analysis.metrics.swingSpeed.racketMph).toBeCloseTo(expected*2.237*1.75,8);
    expect(analysis.frames[8].jointAngles.rightElbow).toBe(180);
    expect(analysis.frames[8].trackingConfidence).toBeCloseTo(9*0.9/17,8);
    expect(analysis.frames[8].t).toBe(800);
    const saved=await store.getPracticeData(session.id);
    expect(saved.recordings[0].poseFrames).toEqual(raw);
    expect(saved.recordings[0].analysis).toEqual(analysis);
    expect(saved.recordings[0].videoReference.clipId).toBe(clip.id);
  });

  it('uses video dimensions for joint angles and rejects unclear landmarks', () => {
    const kp=Array<number>(51).fill(0);
    for (const [index,x,y] of [[5,0,0],[7,0.5,0],[9,1,1]]) {
      if (index === undefined || x === undefined || y === undefined) throw new Error('Invalid fixture');
      kp[index*3]=x; kp[index*3+1]=y; kp[index*3+2]=0.9;
    }
    expect(jointAngle(kp,[5,7,9],200,100)).toBeCloseTo(135,8);
    kp[9*3+2]=0.1;
    expect(jointAngle(kp,[5,7,9],200,100)).toBeNull();
  });

  it('stores unavailable values as null rather than invented zero measurements', () => {
    const analysis=buildClipAnalysis({id:'empty',sessionId:'practice',dominantHand:'right',video:{width:1000,height:1000}},[{t:123,kp:null}]);
    expect(analysis.metrics).toEqual({contact:null,swingSpeed:null});
    expect(frameMetrics({t:123,kp:null},1000,1000)).toMatchObject({t:123,trackingConfidence:null,jointAngles:{rightElbow:null}});
  });

  it('keeps future stroke types without applying serve-specific contact rules', async () => {
    const session=await store.createSession(null,{strokeType:'forehand',playerHand:'R'});
    const clip=await store.createClip(session.id,{status:'saved',video:{width:1000,height:1000,durationMs:1200}});
    await store.putPoses(clip.id,0,frames());
    const analysis=await store.finalizeClipData(clip.id);
    expect(analysis.strokeType).toBe('forehand');
    expect(analysis.metrics.contact).toBeNull();
    expect(analysis.metrics.swingSpeed).toBeNull();
    expect(analysis.frames[8].jointAngles.rightElbow).toBe(180);
  });

  it('backfills saved clips and removes derived measurements with their recording', async () => {
    expect(await store.getClipAnalysis('legacy-clip')).toBeUndefined();
    await store.backfillPracticeData();
    expect(await store.getClipAnalysis('legacy-clip')).toMatchObject({clipId:'legacy-clip',frames:[{t:0,trackingConfidence:null}]});
    await store.deleteSession('legacy');
    expect(await store.getClipAnalysis('legacy-clip')).toBeUndefined();
    expect(await store.getPracticeData('legacy')).toBeNull();
  });

  it('recovers interrupted recordings with their pose data and marks duration as estimated', async () => {
    const session=await store.createSession(null,{playerHand:'R'});
    const clip=await store.createClip(session.id,{video:{width:1000,height:1000,durationMs:0},sync:{offsetMs:0,method:'saved'}});
    await store.putPoses(clip.id,0,frames());
    // Blob byte metadata fixture for fake IndexedDB (real Blob persistence is browser-tested).
    await store.putChunk(clip.id,0,{size:20000});
    await store.recoverUnfinishedClips();
    await store.backfillPracticeData();
    const recovered=await store.getClip(clip.id);
    expect(recovered).toMatchObject({status:'interrupted',video:{durationMs:2000,durationSource:'recovered-estimate'}});
    expect((await store.getSession(session.id)).recordingDurationMs).toBe(2000);
    expect((await store.getClipAnalysis(clip.id)).metrics.contact.poseTimestampMs).toBe(800);
    expect(await store.getClipPoses(clip.id)).toEqual(frames());
  });
});