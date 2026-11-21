import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error static app module
import { buildClipAnalysis } from '../../public/serve-coach/js/practice-data.js';
// @ts-expect-error static app module
import * as store from '../../public/serve-coach/js/store.js';
// @ts-expect-error static app module
import { buildJournal } from '../../public/serve-coach/js/journal.js';

function poses(bent = false, left = false) {
  return [[800,350,350,350],[700,350,350,350],[600,350,350,350],[500,350,350,350],
    [450,300,350,300],[430,290,350,300],[350,250,350,325],[350,200,350,300],
    [350,150,bent ? 390 : 350,275],[360,220,355,310],[370,260,360,330],[410,330,380,350]].map((m,n) => {
    const kp = Array<number>(51).fill(0);
    const set = (i:number,x:number,y:number) => { kp[i*3]=x/1000; kp[i*3+1]=y/1000; kp[i*3+2]=0.9; };
    set(0,300,250); set(5,250,400); set(6,350,400); set(11,250,600); set(12,350,600);
    set(8,m[2] ?? 0,m[3] ?? 0); set(10,m[0] ?? 0,m[1] ?? 0);
    if (left) for (const [a,b] of [[5,6],[7,8],[9,10]]) {
      if (a === undefined || b === undefined) throw new Error('fixture');
      for (let j=0;j<3;j++) { const v=kp[a*3+j] ?? 0; kp[a*3+j]=kp[b*3+j] ?? 0; kp[b*3+j]=v; }
    }
    return {t:n*100,kp};
  });
}
const clip = { id:'coach-clip',sessionId:'coach-session',dominantHand:'right',strokeType:'serve',
  video:{width:1000,height:1000,durationMs:1600},sync:{offsetMs:-350,method:'measured'} };

describe('recording-based coaching evidence', () => {
  it('links a real arm-extension observation and recommendation to the correct saved frame and video clock', () => {
    const c=buildClipAnalysis(clip,poses()).coaching;
    expect(c.status).toBe('supported');
    expect(c.positive.evidence).toMatchObject({clipId:'coach-clip',frameIndex:8,poseTimestampMs:800,timestampMs:1150,elbowAngleDegrees:180,minLandmarkConfidence:0.9});
    expect(c.recommendation.evidence.frameIndex).toBe(8);
  });
  it('does not fabricate an improvement for an already extended arm', () => {
    expect(buildClipAnalysis(clip,poses()).coaching.improvement).toBeNull();
  });
  it('offers a potential improvement only for observed partial extension', () => {
    const c=buildClipAnalysis(clip,poses(true)).coaching;
    expect(c.status).toBe('supported');
    expect(c.improvement.evidence.elbowAngleDegrees).toBeCloseTo(144.51,1);
    expect(c.recommendation.evidence).toEqual(c.improvement.evidence);
  });
  it('withholds all advice when selected-arm confidence is low despite other clear landmarks', () => {
    const f=poses(); const frame=f[8]; if (!frame) throw new Error('fixture'); frame.kp[10*3+2]=0.59;
    const a=buildClipAnalysis(clip,f);
    expect(a.metrics.contact).not.toBeNull();
    expect(a.coaching).toMatchObject({status:'insufficient',positive:null,improvement:null,recommendation:null});
  });
  it('rejects a gap after peak reach and duplicated timestamps', () => {
    for (const t of [800,1101]) {
      const f=poses(); const frame=f[9]; if (!frame) throw new Error('fixture'); frame.t=t;
      expect(buildClipAnalysis(clip,f).coaching.status).toBe('insufficient');
    }
  });
  it('withholds coaching when poses or captured serving hand are missing', () => {
    expect(buildClipAnalysis(clip,[]).coaching.positive).toBeNull();
    expect(buildClipAnalysis({...clip,dominantHand:null},poses(),{arm:'right'}).coaching.status).toBe('insufficient');
  });
  it('does not apply serve advice to future strokes', () => {
    expect(buildClipAnalysis({...clip,strokeType:'forehand'},poses()).coaching.status).toBe('insufficient');
  });
  it('supports the recorded left arm without taking the opposite arm', () => {
    expect(buildClipAnalysis({...clip,dominantHand:'left'},poses(true,true)).coaching.improvement.evidence.frameIndex).toBe(8);
  });
  it('keeps saved-frame evidence but withholds a video timestamp before alignment', () => {
    expect(buildClipAnalysis({...clip,sync:null},poses()).coaching.positive.evidence).toMatchObject({frameIndex:8,timestampMs:null});
  });
  it('persists observations with the recording and includes them in the media-free journal', async () => {
    const s=await store.createSession(null,{playerHand:'R'});
    const c=await store.createClip(s.id,{status:'saved',video:clip.video,sync:clip.sync});
    await store.putPoses(c.id,0,poses(true));
    const a=await store.finalizeClipData(c.id);
    expect((await store.getClipAnalysis(c.id)).coaching).toEqual(a.coaching);
    const data=await store.getJournalData();
    expect(data.analyses.find((entry:{clipId:string})=>entry.clipId===c.id).coaching.improvement.evidence.timestampMs).toBe(1150);
    expect(buildJournal(data)).toContain(a.coaching.recommendation.text);
  });
});