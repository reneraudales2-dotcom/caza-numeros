// boardWorker.js - Web Worker to generate and shuffle the number board for Caza Números

self.addEventListener('message', (e) => {
  const { maxNumbers } = e.data;
  // Generate array 1..maxNumbers
  const nums = [];
  for (let i = 1; i <= maxNumbers; i++) {
    nums.push(i);
  }
  // Fisher-Yates shuffle
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  // Post back the shuffled array
  self.postMessage({ board: nums });
});
