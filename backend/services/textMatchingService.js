import { normalizeText } from './supplierCatalogHelpersService.js';

export const extractTokens = (text) => {
  const normalized = normalizeText(text);
  return normalized.split(/\s+/).filter((token) => token.length > 0);
};

export const levenshteinDistance = (str1, str2) => {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        );
      }
    }
  }

  return dp[m][n];
};

export const similarityRatio = (str1, str2) => {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
};

export const calculateMatchConfidence = (query, productName, productDescription = '') => {
  const queryNormalized = normalizeText(query);
  const productNormalized = normalizeText(productName);
  const descNormalized = normalizeText(productDescription);

  if (queryNormalized === productNormalized) return 1.0;

  const nameSimilarity = similarityRatio(queryNormalized, productNormalized);
  const descSimilarity = descNormalized ? similarityRatio(queryNormalized, descNormalized) : 0;
  const maxSimilarity = Math.max(nameSimilarity, descSimilarity);

  if (maxSimilarity > 0.9) {
    return 0.9 + (maxSimilarity - 0.9) * 1.0;
  }

  if (productNormalized.includes(queryNormalized) || queryNormalized.includes(productNormalized)) {
    const lengthRatio = Math.min(queryNormalized.length, productNormalized.length) / Math.max(queryNormalized.length, productNormalized.length);
    return 0.85 + lengthRatio * 0.1;
  }

  const queryTokens = extractTokens(query);
  const productTokens = extractTokens(productName);
  const descTokens = extractTokens(productDescription);
  const allProductTokens = [...productTokens, ...descTokens];

  let totalTokenScore = 0;
  let matchedTokens = 0;

  for (const queryToken of queryTokens) {
    if (queryToken.length < 2) continue;

    let bestMatch = 0;
    for (const productToken of allProductTokens) {
      if (productToken.length < 2) continue;
      if (queryToken === productToken) {
        bestMatch = 1.0;
        break;
      }
      if (queryToken.includes(productToken) || productToken.includes(queryToken)) {
        const tokenSimilarity = Math.min(queryToken.length, productToken.length) / Math.max(queryToken.length, productToken.length);
        bestMatch = Math.max(bestMatch, tokenSimilarity * 0.8);
      }
      if (queryToken.length > 3 && productToken.length > 3) {
        const tokenSim = similarityRatio(queryToken, productToken);
        if (tokenSim > 0.7) bestMatch = Math.max(bestMatch, tokenSim * 0.7);
      }
    }
    if (bestMatch > 0.5) {
      matchedTokens++;
      totalTokenScore += bestMatch;
    }
  }

  const tokenMatchRatio = queryTokens.length > 0 ? matchedTokens / queryTokens.length : 0;
  const avgTokenScore = matchedTokens > 0 ? totalTokenScore / matchedTokens : 0;
  const combinedScore = maxSimilarity * 0.4 + tokenMatchRatio * avgTokenScore * 0.6;

  if (tokenMatchRatio > 0.7) return Math.max(0.7 + combinedScore * 0.15, combinedScore);
  if (tokenMatchRatio > 0.3) return Math.max(0.5 + combinedScore * 0.2, combinedScore);
  return Math.max(0.0, combinedScore);
};

export const calculateMatchConfidenceBoq = (query, productName, productDescription = '') => {
  const score = calculateMatchConfidence(query, productName, productDescription);
  const qn = normalizeText(query);
  const pn = normalizeText(productName);
  const dn = normalizeText(productDescription);
  const maxSimilarity = Math.max(similarityRatio(qn, pn), dn ? similarityRatio(qn, dn) : 0);

  if (score > 0.3) return score;
  if (maxSimilarity > 0.5 || score > 0.3) return Math.max(0.3 + score * 0.4, score);
  return Math.max(0.2, score);
};
