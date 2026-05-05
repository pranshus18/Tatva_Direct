export const normalizeUserType = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

export const normalizeUser = (user) => {
  if (!user || typeof user !== 'object') return user;
  const normalizedType = normalizeUserType(user.userType || user.user_type);
  return {
    ...user,
    userType: normalizedType
  };
};
