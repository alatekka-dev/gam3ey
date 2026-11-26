# GAM3EY – single container: builds the React client and serves it from the API server.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npm", "start"]
