import { FastifyInstance } from 'fastify';
import { Connection, getConnection } from 'typeorm';
import { ApolloServer } from 'apollo-server-fastify';
import {
  ApolloServerTestClient,
  createTestClient,
} from 'apollo-server-testing';
import request from 'supertest';
import _ from 'lodash';
import { mocked } from 'ts-jest/utils';
import { SearchIndex } from 'algoliasearch';

import createApolloServer from '../src/apollo';
import { Context } from '../src/Context';
import {
  authorizeRequest,
  MockContext,
  saveFixtures,
  testMutationErrorCode,
  testQueryErrorCode,
} from './helpers';
import appFunc from '../src';
import {
  Feed,
  FeedTag,
  Post,
  PostTag,
  Source,
  SourceDisplay,
  View,
  BookmarkList,
} from '../src/entity';
import { sourcesFixture } from './fixture/source';
import { postsFixture, postTagsFixture } from './fixture/post';
import { sourceDisplaysFixture } from './fixture/sourceDisplay';
import { FeedSource } from '../src/entity/FeedSource';
import { getPostsIndex, Ranking } from '../src/common';

let app: FastifyInstance;
let con: Connection;
let server: ApolloServer;
let client: ApolloServerTestClient;
let loggedUser: string = null;

jest.mock('../src/common/algolia', () => ({
  ...jest.requireActual('../src/common/algolia'),
  getPostsIndex: jest.fn(),
}));

beforeAll(async () => {
  con = await getConnection();
  server = await createApolloServer({
    context: (): Context => new MockContext(con, loggedUser),
    playground: false,
  });
  client = createTestClient(server);
  app = await appFunc();
  return app.ready();
});

beforeEach(async () => {
  loggedUser = null;

  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, SourceDisplay, sourceDisplaysFixture);
  await saveFixtures(con, Post, postsFixture);
  await saveFixtures(con, PostTag, postTagsFixture);
});

afterAll(() => app.close());

const saveFeedFixtures = async (): Promise<void> => {
  await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
  await saveFixtures(con, FeedTag, [
    { feedId: '1', tag: 'html' },
    { feedId: '1', tag: 'javascript' },
  ]);
  await saveFixtures(con, FeedSource, [
    { feedId: '1', sourceId: 'b' },
    { feedId: '1', sourceId: 'c' },
  ]);
};

const feedFields = `
pageInfo {
  endCursor
  hasNextPage
}
edges {
  node {
    id
    url
    title
    readTime
    tags
    source {
      id
      name
      image
      public
    }
  }
}`;

describe('query anonymousFeed', () => {
  const QUERY = (
    ranking: Ranking = Ranking.POPULARITY,
    now = new Date(),
    first = 10,
  ): string => `
  query AnonymousFeed($filters: FiltersInput) {
    anonymousFeed(filters: $filters, ranking: ${ranking}, now: "${now.toISOString()}", first: ${first}) {
      ${feedFields}
    }
  }
`;

  it('should return anonymous feed with no filters ordered by popularity', async () => {
    const res = await client.query({ query: QUERY() });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed with no filters ordered by time', async () => {
    const res = await client.query({ query: QUERY(Ranking.TIME) });
    delete res.data.anonymousFeed.pageInfo.endCursor;
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed filtered by sources', async () => {
    const res = await client.query({
      query: QUERY(),
      variables: { filters: { includeSources: ['a', 'b'] } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed filtered by tags', async () => {
    const res = await client.query({
      query: QUERY(),
      variables: { filters: { includeTags: ['html', 'webdev'] } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed while excluding sources', async () => {
    const res = await client.query({
      query: QUERY(),
      variables: { filters: { excludeSources: ['a'] } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed filtered by tags and sources', async () => {
    const res = await client.query({
      query: QUERY(),
      variables: {
        filters: {
          includeTags: ['javascript'],
          includeSources: ['a', 'b'],
        },
      },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query feed', () => {
  const QUERY = (
    unreadOnly?: boolean,
    ranking: Ranking = Ranking.POPULARITY,
    now = new Date(),
    first = 10,
  ): string => `{
    feed(ranking: ${ranking}, now: "${now.toISOString()}", first: ${first}${
    unreadOnly ? ', unreadOnly: true' : ''
  }) {
      ${feedFields}
    }
  }
`;

  it('should not authorize when not logged-in', () =>
    testQueryErrorCode(client, { query: QUERY() }, 'UNAUTHENTICATED'));

  it('should return feed with preconfigured filters', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.query({ query: QUERY() });
    expect(res.data).toMatchSnapshot();
  });

  it('should return preconfigured feed with tags filters only', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await saveFixtures(con, FeedTag, [{ feedId: '1', tag: 'html' }]);
    const res = await client.query({ query: QUERY() });
    expect(res.data).toMatchSnapshot();
  });

  it('should return preconfigured feed with sources filters only', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await saveFixtures(con, FeedSource, [{ feedId: '1', sourceId: 'a' }]);
    const res = await client.query({ query: QUERY() });
    expect(res.data).toMatchSnapshot();
  });

  it('should return preconfigured feed with no filters', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    const res = await client.query({ query: QUERY() });
    expect(res.data).toMatchSnapshot();
  });

  it('should return unread posts from preconfigured feed', async () => {
    loggedUser = '1';
    await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
    await con.getRepository(View).save([{ userId: '1', postId: 'p1' }]);
    const res = await client.query({ query: QUERY(true) });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query sourceFeed', () => {
  const QUERY = (
    source: string,
    ranking: Ranking = Ranking.POPULARITY,
    now = new Date(),
    first = 10,
  ): string => `{
    sourceFeed(source: "${source}", ranking: ${ranking}, now: "${now.toISOString()}", first: ${first}) {
      ${feedFields}
    }
  }`;

  it('should return a single source feed', async () => {
    const res = await client.query({ query: QUERY('b') });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query tagFeed', () => {
  const QUERY = (
    tag: string,
    ranking: Ranking = Ranking.POPULARITY,
    now = new Date(),
    first = 10,
  ): string => `{
    tagFeed(tag: "${tag}", ranking: ${ranking}, now: "${now.toISOString()}", first: ${first}) {
      ${feedFields}
    }
  }`;

  it('should return a single tag feed', async () => {
    const res = await client.query({ query: QUERY('javascript') });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query feedSettings', () => {
  const QUERY = `{
    feedSettings {
      id
      userId
      includeTags
      excludeSources {
        id
        name
        image
        public
      }
    }
  }`;

  it('should not authorize when not logged-in', () =>
    testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED'));

  it('should return the feed settings', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.query({ query: QUERY });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query searchPostSuggestions', () => {
  const QUERY = (query: string): string => `{
    searchPostSuggestions(query: "${query}") {
      query
      hits {
        title
      }
    }
  }
`;

  it('should return search suggestions', async () => {
    const searchMock = jest.fn();
    mocked(getPostsIndex).mockReturnValue(({
      search: searchMock,
    } as unknown) as SearchIndex);
    searchMock.mockResolvedValue({
      hits: [
        {
          objectID: '1',
          title: 'title',
          _highlightResult: { title: { value: '<strong>t</strong>itle' } },
        },
      ],
    });
    const res = await client.query({ query: QUERY('text') });
    expect(searchMock).toBeCalledWith('text', expect.anything());
    expect(res.data).toMatchSnapshot();
  });
});

describe('query searchPosts', () => {
  const QUERY = (query: string, now = new Date(), first = 10): string => `{
    searchPosts(query: "${query}", now: "${now.toISOString()}", first: ${first}) {
      query
      ${feedFields}
    }
  }
`;

  it('should return search feed', async () => {
    const searchMock = jest.fn();
    mocked(getPostsIndex).mockReturnValue(({
      search: searchMock,
    } as unknown) as SearchIndex);
    searchMock.mockResolvedValue({
      hits: [{ objectID: 'p3' }, { objectID: 'p1' }],
    });
    const res = await client.query({ query: QUERY('text') });
    expect(searchMock).toBeCalledWith('text', expect.anything());
    expect(res.data).toMatchSnapshot();
  });
});

describe('query rssFeeds', () => {
  const QUERY = `{
    rssFeeds {
      name, url
    }
  }`;

  it('should not authorize when not logged-in', () =>
    testQueryErrorCode(client, { query: QUERY }, 'UNAUTHENTICATED'));

  it('should return rss feeds', async () => {
    loggedUser = '1';
    const list = await con
      .getRepository(BookmarkList)
      .save({ userId: loggedUser, name: 'list' });
    const res = await client.query({ query: QUERY });
    expect(res.data.rssFeeds).toEqual([
      { name: 'Recent news feed', url: 'http://localhost:4000/rss/f/1' },
      { name: 'Bookmarks', url: 'http://localhost:4000/rss/b/1' },
      {
        name: 'list',
        url: `http://localhost:4000/rss/b/l/${list.id.replace(/-/g, '')}`,
      },
    ]);
  });
});

describe('mutation addFiltersToFeed', () => {
  const MUTATION = `
  mutation AddFiltersToFeed($filters: FiltersInput!) {
    addFiltersToFeed(filters: $filters) {
      id
      userId
      includeTags
      excludeSources {
        id
        name
        image
        public
      }
    }
  }`;

  it('should not authorize when not logged-in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { filters: { excludeSources: ['a'] } },
      },
      'UNAUTHENTICATED',
    ));

  it('should add the new feed settings', async () => {
    loggedUser = '1';
    const res = await client.mutate({
      mutation: MUTATION,
      variables: {
        filters: {
          includeTags: ['webdev', 'javascript'],
          excludeSources: ['a', 'b'],
        },
      },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should ignore duplicates', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.mutate({
      mutation: MUTATION,
      variables: {
        filters: {
          includeTags: ['webdev', 'javascript'],
          excludeSources: ['a', 'b'],
        },
      },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('mutation removeFiltersFromFeed', () => {
  const MUTATION = `
  mutation RemoveFiltersFromFeed($filters: FiltersInput!) {
    removeFiltersFromFeed(filters: $filters) {
      id
      userId
      includeTags
      excludeSources {
        id
        name
        image
        public
      }
    }
  }`;

  it('should not authorize when not logged-in', () =>
    testMutationErrorCode(
      client,
      {
        mutation: MUTATION,
        variables: { filters: { excludeSources: ['a'] } },
      },
      'UNAUTHENTICATED',
    ));

  it('should remove existing filters', async () => {
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.mutate({
      mutation: MUTATION,
      variables: {
        filters: {
          includeTags: ['webdev', 'javascript'],
          excludeSources: ['a', 'b'],
        },
      },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('compatibility routes', () => {
  describe('GET /posts/latest', () => {
    it('should return anonymous feed with no filters ordered by popularity', async () => {
      const res = await request(app.server)
        .get('/v1/posts/latest')
        .query({ latest: new Date(), pageSize: 2, page: 0 })
        .send()
        .expect(200);
      expect(res.body.map((x) => _.pick(x, ['id']))).toMatchSnapshot();
    });

    it('should return anonymous feed filtered by sources', async () => {
      const res = await request(app.server)
        .get('/v1/posts/latest')
        .query({ latest: new Date(), sources: ['a', 'b'] })
        .send()
        .expect(200);
      expect(res.body.map((x) => _.pick(x, ['id']))).toMatchSnapshot();
    });

    it('should return anonymous feed filtered by tags', async () => {
      const res = await request(app.server)
        .get('/v1/posts/latest')
        .query({ latest: new Date(), tags: ['html', 'webdev'] })
        .send()
        .expect(200);
      expect(res.body.map((x) => _.pick(x, ['id']))).toMatchSnapshot();
    });

    it('should return anonymous feed filtered by tags and sources', async () => {
      const res = await request(app.server)
        .get('/v1/posts/latest')
        .query({
          latest: new Date(),
          tags: ['javascript'],
          sources: ['a', 'b'],
        })
        .send()
        .expect(200);
      expect(res.body.map((x) => _.pick(x, ['id']))).toMatchSnapshot();
    });

    it('should return preconfigured feed when logged-in', async () => {
      await saveFeedFixtures();
      const res = await authorizeRequest(
        request(app.server)
          .get('/v1/posts/latest')
          .query({ latest: new Date() }),
      )
        .send()
        .expect(200);
      expect(res.body.map((x) => _.pick(x, ['id']))).toMatchSnapshot();
    });
  });

  describe('GET /posts/publication', () => {
    it('should return single source feed', async () => {
      const res = await request(app.server)
        .get('/v1/posts/publication')
        .query({ latest: new Date(), pub: 'b' })
        .send()
        .expect(200);
      expect(res.body.map((x) => _.pick(x, ['id']))).toMatchSnapshot();
    });
  });

  describe('GET /posts/tag', () => {
    it('should return single tag feed', async () => {
      const res = await request(app.server)
        .get('/v1/posts/tag')
        .query({ latest: new Date(), tag: 'javascript' })
        .send()
        .expect(200);
      expect(res.body.map((x) => _.pick(x, ['id']))).toMatchSnapshot();
    });
  });

  describe('GET /feeds/publications', () => {
    it('should return feed publications filters', async () => {
      await saveFeedFixtures();
      const res = await authorizeRequest(
        request(app.server).get('/v1/feeds/publications'),
      ).expect(200);
      expect(res.body).toMatchSnapshot();
    });
  });

  describe('POST /feeds/publications', () => {
    it('should add new feed publications filters', async () => {
      const res = await authorizeRequest(
        request(app.server).post('/v1/feeds/publications'),
      )
        .send([
          { publicationId: 'a', enabled: false },
          { publicationId: 'b', enabled: false },
        ])
        .expect(200);
      expect(res.body).toMatchSnapshot();
    });

    it('should remove existing feed publications filters', async () => {
      await saveFeedFixtures();
      const res = await authorizeRequest(
        request(app.server).post('/v1/feeds/publications'),
      )
        .send([{ publicationId: 'b', enabled: true }])
        .expect(200);
      expect(res.body).toMatchSnapshot();
    });
  });

  describe('GET /feeds/tags', () => {
    it('should return feed tags filters', async () => {
      await saveFeedFixtures();
      const res = await authorizeRequest(
        request(app.server).get('/v1/feeds/tags'),
      ).expect(200);
      expect(res.body).toMatchSnapshot();
    });
  });

  describe('POST /feeds/tags', () => {
    it('should add new feed tags filters', async () => {
      const res = await authorizeRequest(
        request(app.server).post('/v1/feeds/tags'),
      )
        .send([{ tag: 'html' }, { tag: 'javascript' }])
        .expect(200);
      expect(res.body).toMatchSnapshot();
    });
  });
  describe('DELETE /feeds/tags', () => {
    it('should remove existing feed tags filters', async () => {
      await saveFeedFixtures();
      const res = await authorizeRequest(
        request(app.server).delete('/v1/feeds/tags'),
      )
        .send({ tag: 'javascript' })
        .expect(200);
      expect(res.body).toMatchSnapshot();
    });
  });
});
