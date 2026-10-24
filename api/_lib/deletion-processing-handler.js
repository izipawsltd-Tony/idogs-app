export function makeDeletionProcessingHandler({ authorize, processor }) {
  return async (req,res) => {
    res.setHeader('Cache-Control','private, no-store')
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'})
    const actor=await authorize(req,res)
    if(!actor)return
    if(actor.deletionPrototypeOperator!==true)return res.status(403).json({error:'Synthetic deletion operator required'})
    const b=req.body
    if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['action','uid','revision'].includes(k))||b.action!=='process')return res.status(400).json({error:'Invalid processing request'})
    try{return res.status(200).json(await processor.process({uid:b.uid,revision:b.revision}))}
    catch(e){return res.status(e.status||503).json({error:'Synthetic deletion is not complete. Refresh its status before retrying.',code:['DELETION_WORKER_BUSY','DELETION_REQUEST_MISMATCH','DELETION_NOT_ACCEPTED'].includes(e.code)?e.code:'DELETION_PROCESSING_HELD'})}
  }
}
