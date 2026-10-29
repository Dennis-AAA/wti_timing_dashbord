/* Fixed research rules. No fetching, storage, performance optimization or writes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.OilEngine=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  const number=x=>finite(x)?x:null;
  const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x);
  function unwrap(x,kind){if(!x)return null;if(kind==='snapshot')return x.data?.assets?x:(x.snapshot?.data?x.snapshot:null);if(x.records||x.latest)return x;return x.data&&typeof x.data==='object'?x.data:x;}
  function trendAt(rows,i){
    if(i<20)return null;
    const values=rows.slice(i-20,i+1).map(r=>r.adjustedClose);
    if(values.some(x=>!finite(x)))return null;
    const diffs=values.slice(1).map((x,k)=>x-values[k]);
    const mean=diffs.reduce((a,b)=>a+b,0)/20;
    const sd=Math.sqrt(diffs.reduce((a,b)=>a+(b-mean)**2,0)/19);
    return sd>0?(values[20]-values[0])/(sd*Math.sqrt(20)):null;
  }
  function mergeRows(history,inputs={}){
    const warnings=[], cutoff=history.backtestCutoff||'2026-10-08';
    const map=new Map(history.rows.map(r=>[r.date,{...r}]));
    const ensure=date=>{if(!map.has(date))map.set(date,{date,price:null,adjustedClose:null,t20:null,rank150:null,rank175:null,priceQuality:'unverified',source:'daily_api'});return map.get(date);};
    const snap=unwrap(inputs.snapshot,'snapshot'),expanded=unwrap(inputs.oil175,'oil175'),research=unwrap(inputs.research,'research');
    const officialTrend=new Map();
    if(snap?.data?.assets){
      const a=snap.data.assets.find(x=>x.k==='CL');
      if(a){
        let offset=null;
        for(let i=a.di.length-1;i>=0;i--){const d=snap.data.dates[a.di[i]],old=map.get(d);if(old&&finite(old.adjustedClose)&&finite(a.chg?.[i])){offset=old.adjustedClose-a.chg[i];break;}}
        a.di.forEach((di,i)=>{const d=snap.data.dates[di];if(!dateOK(d)||d<=cutoff)return;const r=ensure(d);r.price=number(a.raw?.[i]);r.adjustedClose=finite(offset)&&finite(a.chg?.[i])?a.chg[i]+offset:r.adjustedClose;r.priceQuality=finite(r.price)?'observed':'unverified';});
      }
      const obs=snap.data.observations?.CL?.rows||[];
      obs.forEach(x=>{if(!dateOK(x.date)||x.date<=cutoff)return;const r=ensure(x.date);r.rank150=number(x.rank);if(!finite(r.price)&&finite(x.price))r.price=x.price;});
    }else if(inputs.snapshot)warnings.push('原六资产接口格式异常，保留已保存数据。');
    if(expanded){
      if(history.expectedOil175RuleHash&&history.expectedOil175RuleHash!==expanded.rule_hash){warnings.push('1.75倍规则指纹缺失或发生变化；停止合并该版本新分位，等待核查。');}
      else {const list=[expanded.seed,...(expanded.records||[]),expanded.latest].filter(Boolean);list.forEach(x=>{if(!dateOK(x.date)||x.date<=cutoff)return;const r=ensure(x.date);r.rank175=number(x.expanded?.rank);if(!finite(r.price)&&finite(x.price))r.price=x.price;});}
    }
    if(research){const list=[...(research.records||[]).filter(x=>x.asset==='CL'),research.latest?.CL].filter(Boolean);list.forEach(x=>{if(dateOK(x.date)&&finite(x.trend))officialTrend.set(x.date,x.trend);});}
    const rows=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
    rows.forEach((r,i)=>{if(r.date>cutoff){const computed=trendAt(rows,i);r.t20=officialTrend.has(r.date)?officialTrend.get(r.date):(finite(computed)?computed:r.t20);}});
    const asOf=rows.at(-1)?.date||null;
    if(snap?.data?.end&&snap.data.end<asOf)warnings.push('原六资产接口日期较旧；显示已保存的更新快照，未向旧日期回退。');
    const last=rows.at(-1);if(last&&!finite(last.rank150))warnings.push('1.5倍最新期权分位缺测；未知不等于熄灯，也不续期。');
    if(last&&!finite(last.rank175))warnings.push('1.75倍最新期权分位缺测；保留计时，等待原接口恢复。');
    return {rows,asOf,warnings,sourceDates:{snapshot:snap?.data?.end||null,oil175:expanded?.latest?.date||null,research:research?.latest?.CL?.date||null}};
  }
  function calculate(rows,rule,start='2021-01-01'){
    let remaining=0,priorHolding=false;
    const result=[];
    rows.forEach((row,i)=>{
      const rank=number(row[rule.rankField]),t20=number(row.t20);
      const known=finite(rank)&&finite(t20);
      const trigger=known?(rank>.8&&Math.abs(t20)<=rule.trendLimit):null;
      const source=i>=2?result[i-2]:null;
      let execution=source?source.trigger:null;
      const active=row.date>=start;
      if(!active){remaining=0;execution=false;}else{remaining=Math.max(0,remaining-1);if(execution===true)remaining=20;}
      const holding=active&&remaining>0;
      const r={...row,strategy:rule.id,rank,trigger,execution,executionSourceDate:source?.date||null,
        holding,remaining,entered:holding&&!priorHolding,exited:!holding&&priorHolding,
        renewed:execution===true&&priorHolding,eligibleHistory:active,
        reason:!known?'input_unknown':rank<=.8?'dispersion_not_high':Math.abs(t20)>rule.trendLimit?'trend_too_strong':'both_conditions_met'};
      result.push(r);priorHolding=holding;
    });
    return {rule,rows:result,latest:result.at(-1)||null};
  }
  function buildView(history,inputs={}){
    if(!history||history.schemaVersion!==1||!Array.isArray(history.rows))throw Error('Unsupported oil history schema');
    const merged=mergeRows(history,inputs),strategies={};
    history.strategies.forEach(rule=>{strategies[rule.id]=calculate(merged.rows,rule,history.simulationStart);});
    return {...merged,strategies,backtests:history.backtests||[],coverage:history.coverage||[],methodology:history.methodology||{},backtestCutoff:history.backtestCutoff};
  }
  return {buildView,mergeRows,calculate,trendAt};
});
