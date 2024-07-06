// 转自 @suiyuran
let url = $request.url;
let hasUid = (url) => url.includes("uid");
let getUid = (url) => (hasUid(url) ? url.match(/uid=(\d+)/)[1] : undefined);

// 替换单字符串的函数
let replaceString = (str) => {
  let newStr = str.replace("01A57gF-4IeYWcLdRTObYmMprlAE3yrtzh1ChnNzU9XTP1YMs", "01A1ARC2VDHpvFs4h4J0t3loBZXf4zZPcWxbsn7Y4Y_ToVXQ4");
  newStr = newStr.replace("_2A25JgpXFDeRxGeRI4lUY8S_EyT2IHXVoGa4NrDV6PUJbkdAGLVT6kWpNUpSb2BqK7UB7ynrzO1n_weQ7Eb8v4HbU", "_2A25LjWOtDeRxGeRI4lUY8S_EyT2IHXVmG_BlrDV6PUJbkdCOLWjdkWpNUpSb2E7AUMRoDjZZkeVs2fdztphSwp90");
  return newStr;
}

// 替换 URL 中的字符串
url = replaceString(url);

if (url.includes("users/show")) {
  $persistentStore.write(getUid(url), "uid");
  $done({});
} else if (url.includes("statuses/user_timeline")) {
  let uid = getUid(url) || $persistentStore.read("uid");
  url = url.replace("statuses/user_timeline", "profile/statuses/tab").replace("max_id", "since_id");
  url = url + `&containerid=230413${uid}_-_WEIBO_SECOND_PROFILE_WEIBO`;
  $done({ url });
} else if (url.includes("profile/statuses/tab")) {
  let data = JSON.parse($response.body);
  let statuses = data.cards
    .map((card) => (card.card_group ? card.card_group : card))
    .flat()
    .filter((card) => card.card_type === 9)
    .map((card) => card.mblog);
  let sinceId = data.cardlistInfo.since_id;
  $done({ body: JSON.stringify({ statuses, since_id: sinceId, total_number: 100 }) });
} else {
  $done({});
}
