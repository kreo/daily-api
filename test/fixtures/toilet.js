import publications from './publications';
import config from '../../src/config';

const input = [
  {
    id: 't1',
    title: 'Post #1',
    url: 'https://myblog.com/post.html',
    publicationId: publications[0].id,
    publishedAt: new Date(2017, 10, 21, 15, 10, 5),
    createdAt: new Date((Math.floor(Date.now() / 1000) - (60 * 60 * 2)) * 1000),
    image: 'https://myblog.com/image.png',
    ratio: 1.2,
    placeholder: 'data:image/png;base64,qweuoi2108js',
    promoted: false,
    tags: ['a', 'b', 'c'],
  },
  {
    id: 't2',
    title: 'Style your Terminal better by mastering these settings 🤩\\xF0\\x9F\\xA4\\xA9',
    url: 'https://myblog.com/post2.html',
    publicationId: publications[1].id,
    createdAt: new Date(Math.floor(Date.now() / 1000) * 1000),
    promoted: false,
  },
  {
    id: 't3',
    title: 'Post #3',
    url: 'https://myblog.com/post3.html',
    publicationId: publications[2].id,
    createdAt: new Date((Math.floor(Date.now() / 1000) - (60 * 60)) * 1000),
    promoted: false,
  },
  {
    id: 't4',
    title: 'Post #4',
    url: 'https://myblog.com/post4.html',
    publicationId: publications[2].id,
    createdAt: new Date(2017, 10, 21, 15, 11, 10),
    promoted: true,
  },
];

const output = [
  {
    id: input[1].id,
    title: input[1].title,
    url: input[1].url,
    publishedAt: null,
    createdAt: input[1].createdAt,
    image: config.defaultImage.url,
    ratio: config.defaultImage.ratio,
    placeholder: config.defaultImage.placeholder,
    publication: {
      id: publications[1].id,
      name: publications[1].name,
      image: publications[1].image,
    },
  },
  {
    id: input[0].id,
    title: input[0].title,
    url: input[0].url,
    publishedAt: input[0].publishedAt,
    createdAt: input[0].createdAt,
    image: input[0].image,
    ratio: 1.2,
    placeholder: 'data:image/png;base64,qweuoi2108js',
    publication: {
      id: publications[0].id,
      name: publications[0].name,
      image: publications[0].image,
    },
  },
];

const bookmarks = [
  { userId: 'user1', postId: input[3].id },
];

export default {
  input,
  output,
  bookmarks,
};