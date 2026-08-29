export const buildPagination = (page = 1, pageSize = 20) => ({
  skip: (page - 1) * pageSize,
  take: pageSize
});
