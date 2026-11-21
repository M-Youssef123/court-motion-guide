import { analyzeServeContact, servingArm } from './contact-analysis.js';
import { jointAngle } from './practice-data.js';
import { referencePose, REFERENCE_WIDTH, REFERENCE_HEIGHT } from './phase-reference.js';

export const PHASE_VERSION = 1;
export function clearPoint(frame, index) {
  const x=frame?.kp?.[index*3], y=frame?.kp?.[index*3+1], score=frame?.kp?.[index*3+2];
  return Number.isFinite(x) && x>=0 && x<=1 && Number.isFinite(y) && y>=0 && y<=1
    && Number.isFinite(score) && score>=0.6 && score<=1;
}
const parts = (arm) => arm === 'right' ? { shoulder:6,elbow:8,wrist:10,tossShoulder:5,tossElbow:7,tossWrist:9 }
  : { shoulder:5,elbow:7,wrist:9,tossShoulder:6,tossElbow:8,tossWrist:10 };
export function detectServePhases(frames, clip, offsetMs = clip.sync?.offsetMs ?? 0) {
  const result = { toss:null,trophy:null,finish:null };
  const arm=servingArm(clip.dominantHand || clip.servingArm), w=clip.video?.width,h=clip.video?.height;
  if (!arm || (clip.strokeType || 'serve') !== 'serve' || !Array.isArray(frames)) return result;
  const p=parts(arm), contact=analyzeServeContact(frames,{width:w,height:h,arm,offsetMs});
  if (!contact) return result;
  const angle = (f, toss=false) => jointAngle(f.kp,toss ? [p.tossShoulder,p.tossElbow,p.tossWrist] : [p.shoulder,p.elbow,p.wrist],w,h);
  const stable = (i, ids) => {
    const window=frames.slice(i-1,i+2);
    return i>0 && window.length===3 && window.every(f=>Number.isFinite(f.t) && ids.every(n=>clearPoint(f,n)))
      && window.every((f,n)=>n===0 || (f.t>window[n-1].t && f.t-window[n-1].t<=200));
  };
  const hit=contact.contactFrameIndex;
  if (!stable(hit,[0,p.shoulder,p.elbow,p.wrist])) return result;
  const save=(i)=>({version:PHASE_VERSION,frameIndex:i,poseTimestampMs:frames[i].t,videoTimestampMs:frames[i].t-offsetMs,source:'automatic'});
  // Trophy is the latest supported bent serving elbow before overhead reach.
  for(let i=hit-1;i>0 && frames[hit].t-frames[i].t<=500;i--) {
    if (!stable(i,[p.shoulder,p.elbow,p.wrist,p.tossShoulder,p.tossElbow,p.tossWrist])) continue;
    const a=angle(frames[i]);
    if (a>=45 && a<115 && frames[i].kp[p.tossWrist*3+1]<frames[i].kp[p.tossShoulder*3+1]) { result.trophy=save(i); break; }
  }
  if (!result.trophy) return result;
  // Raised non-serving arm is a toss-position estimate, never detected ball release.
  for(let i=result.trophy.frameIndex-1;i>0 && frames[hit].t-frames[i].t<=1500;i--) {
    if (!stable(i,[0,p.tossShoulder,p.tossElbow,p.tossWrist])) continue;
    if (angle(frames[i],true)>=150 && frames[i].kp[p.tossWrist*3+1]<frames[i].kp[1]) { result.toss=save(i); break; }
  }
  // Finish denotes a visible post-reach arm lowering, not a balanced landing or ball result.
  for(let i=hit+1;i<frames.length-1 && frames[i].t-frames[hit].t<=1200;i++) {
    if (!stable(i,[p.shoulder,p.elbow,p.wrist])) continue;
    const y=frames[i].kp[p.wrist*3+1];
    if (y>frames[i].kp[p.shoulder*3+1] && y>frames[i-1].kp[p.wrist*3+1]
      && frames[i+1].kp[p.wrist*3+1]>=y) { result.finish=save(i); break; }
  }
  for(const phase of Object.keys(result)) {
    const choice=result[phase];
    if(choice && (choice.videoTimestampMs<0 || choice.videoTimestampMs>clip.video?.durationMs)) result[phase]=null;
  }
  return result;
}

export function nearestPhasePose(frames, videoMs, offsetMs, maxGapMs=100) {
  if (!Number.isFinite(videoMs) || !Number.isFinite(offsetMs)) return null;
  const target=videoMs+offsetMs;
  let best=null;
  for(const f of frames) if(Number.isFinite(f.t) && (!best || Math.abs(f.t-target)<Math.abs(best.t-target))) best=f;
  return best && Math.abs(best.t-target)<=maxGapMs ? best : null;
}

export function comparePhase(frame, clip, phase) {
  const arm=servingArm(clip.dominantHand || clip.servingArm);
  if (!arm || !frame?.kp) return { elbow:null,wrist:null };
  const p=parts(arm), ref=referencePose(phase,arm), w=clip.video?.width,h=clip.video?.height;
  if (!ref || !(w>0) || !(h>0)) return { elbow:null,wrist:null };
  const ids=phase==='toss' ? [p.tossShoulder,p.tossElbow,p.tossWrist] : [p.shoulder,p.elbow,p.wrist];
  const observed=ids.every(n=>clearPoint(frame,n)) ? jointAngle(frame.kp,ids,w,h) : null;
  const reference=jointAngle(ref,ids,REFERENCE_WIDTH,REFERENCE_HEIGHT);
  const shoulder=ids[0],wrist=ids[2];
  return { elbow: observed===null ? null : { observedDegrees:observed,referenceDegrees:reference,differenceDegrees:observed-reference },
    wrist:[shoulder,wrist].every(n=>clearPoint(frame,n)) ? {
      observed:frame.kp[wrist*3+1]<frame.kp[shoulder*3+1] ? 'above' : 'below',
      reference:ref[wrist*3+1]<ref[shoulder*3+1] ? 'above' : 'below',
    } : null };
}