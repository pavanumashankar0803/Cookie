FROM node:20-alpine
WORKDIR /app
COPY package.json server.js site-cookies.json ./
COPY public ./public
ENV PORT=3000 TRUST_PROXY=1 PROFILE_FILE=/data/profile.json
EXPOSE 3000
RUN mkdir -p /data && chown node /data
VOLUME /data
USER node
CMD ["node", "server.js"]
