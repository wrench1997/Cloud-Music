// Component refs disappear on remount; a Drive request must still have only one owner.
const inFlightUploads = new Map();

async function transferDownloadedFiles(task, {
  getAccount, getUpload, shouldUpload, isActive, fetchFile, saveLocal,
  handled, storage, onStatus = () => {}, metadataOnly = false,
}) {
  const account = getAccount();
  const result = { total: task.files.length, uploaded: 0, savedLocal: 0, skipped: 0, interrupted: false, cloudRequested: false, account };
  const isCurrent = () => isActive() && getAccount() === account;
  for (const file of task.files) {
    if (!isCurrent()) { result.interrupted = true; break; }
    if (metadataOnly && (!file.metadata || file.metadataRepairSkipped === true)) { result.skipped += 1; continue; }
    const key = `${task.id}:${file.name}`;
    const metadataRevision = task.metadataRepair?.revision ?? file.metadataRevision ?? 'v1';
    const cloudKey = metadataOnly ? `yungan-downloaded-metadata:${account}:${key}:${metadataRevision}` : `yungan-downloaded-upload:${account}:${key}`;
    const handledCloudKey = metadataOnly ? `metadata:${account}:${key}:${metadataRevision}` : `cloud:${account}:${key}`;
    const readCompleted = () => {
      try { if (account && storage?.getItem(cloudKey) === 'complete') handled.add(handledCloudKey); } catch {}
      return handled.has(handledCloudKey);
    };
    readCompleted();
    if (saveLocal) {
      if (!handled.has(`local:${key}`)) {
        onStatus('save', file);
        await saveLocal(file);
        handled.add(`local:${key}`);
      }
      result.savedLocal += 1;
    }
    if (!isCurrent()) { result.interrupted = true; break; }
    const uploadFile = getUpload();
    if (!shouldUpload() || !uploadFile) continue;
    result.cloudRequested = true;
    if (!account) { result.interrupted = true; break; }
    if (!handled.has(handledCloudKey)) {
      onStatus('upload', file);
      let upload = inFlightUploads.get(handledCloudKey);
      if (!upload) {
        const audio = await fetchFile(file);
        if (!isCurrent()) { result.interrupted = true; break; }
        // Another mounted view may have started or completed this file while it was read.
        upload = inFlightUploads.get(handledCloudKey);
        if (!upload && !readCompleted()) {
          upload = Promise.resolve().then(async () => {
            await uploadFile(audio, file.metadata, file);
            handled.add(handledCloudKey);
            try { storage?.setItem(cloudKey, 'complete'); } catch {}
          });
          inFlightUploads.set(handledCloudKey, upload);
          upload.finally(() => {
            if (inFlightUploads.get(handledCloudKey) === upload) inFlightUploads.delete(handledCloudKey);
          }).catch(() => {});
        }
      }
      if (upload) await upload;
      // The request belongs to its original account even if that account changed while it ran.
      handled.add(handledCloudKey);
      try { storage?.setItem(cloudKey, 'complete'); } catch {}
    }
    result.uploaded += 1;
    if (!isCurrent()) { result.interrupted = true; break; }
  }
  return result;
}

module.exports = { transferDownloadedFiles };
