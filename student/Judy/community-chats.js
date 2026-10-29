import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, where, writeBatch
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const firebaseReady = new Promise((resolve) => {
  const check = () => window.MathSprintFirebase?.db && window.MathSprintFirebase?.auth ? resolve(window.MathSprintFirebase) : setTimeout(check, 100);
  check();
});
const firebase = await firebaseReady;
const auth = firebase.auth;
const db = firebase.db;
const $ = (selector) => document.querySelector(selector);
let user = null;
let profile = null;
let conversations = [];
let selectedConversation = null;
let stopConversations = null;
let stopMessages = null;

function setChatStatus(text, error = false) {
  $('#chat-status').textContent = text;
  $('#chat-status').classList.toggle('error', error);
}
function setChatBusy(busy) {
  document.querySelectorAll('[data-chat-action]').forEach((button) => {
    button.disabled = busy;
  });
}
function cleanNickname(value) {
  return value.trim().replace(/\s+/g, ' ');
}
function setRoomPrompt(text) {
  $('#message-feed').replaceChildren();
  const note = document.createElement('p');
  note.className = 'help';
  note.textContent = text;
  $('#message-feed').append(note);
}
function renderConversationList() {
  const list = $('#chat-list');
  list.replaceChildren();
  if (!conversations.length) {
    const note = document.createElement('p');
    note.className = 'help';
    note.textContent = 'No chats yet. Start a private chat or make a group.';
    list.append(note);
    return;
  }
  conversations.forEach((conversation) => {
    const invite = (conversation.pendingUids || []).includes(user.uid);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-list-item' + (selectedConversation?.id === conversation.id ? ' active' : '');
    button.textContent = (conversation.title || 'Student chat') + (invite ? ' · Invite' : '');
    button.addEventListener('click', () => openConversation(conversation));
    list.append(button);
  });
}
function renderMessages(docs) {
  const feed = $('#message-feed');
  feed.replaceChildren();
  if (!docs.length) {
    setRoomPrompt('No messages yet. Say hello!');
    return;
  }
  docs.forEach((item) => {
    const data = item.data();
    const article = document.createElement('article');
    article.className = 'chat-message' + (data.uid === user.uid ? ' mine' : '');
    const heading = document.createElement('div');
    heading.className = 'chat-message-head';
    const author = document.createElement('strong');
    const date = document.createElement('span');
    const body = document.createElement('p');
    author.textContent = data.authorName || 'Student';
    date.textContent = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString() : 'Just now';
    body.textContent = data.text || '';
    heading.append(author, date);
    article.append(heading, body);
    feed.append(article);
  });
  feed.scrollTop = feed.scrollHeight;
}
function showActiveRoom(conversation) {
  selectedConversation = conversation;
  $('#chat-room').hidden = false;
  $('#chat-title').textContent = conversation.title || 'Student chat';
  $('#accept-invite').hidden = true;
  $('#message-text').disabled = false;
  $('#send-message').disabled = false;
  $('#message-text').placeholder = 'Write a kind message…';
  stopMessages?.();
  stopMessages = onSnapshot(
    query(collection(db, 'conversations', conversation.id, 'messages'), orderBy('createdAt', 'desc'), limit(60)),
    (snapshot) => renderMessages(snapshot.docs.slice().reverse()),
    (error) => {
      setRoomPrompt(error.code === 'permission-denied'
        ? 'These chat messages are private to members who accepted the invitation.'
        : 'Could not load messages. Check the Firebase chat rules.');
      console.error(error);
    }
  );
  renderConversationList();
}
async function openConversation(conversation) {
  stopMessages?.();
  stopMessages = null;
  selectedConversation = conversation;
  $('#chat-room').hidden = false;
  $('#chat-title').textContent = conversation.title || 'Student chat';
  $('#message-text').value = '';
  const membership = await getDoc(doc(db, 'conversations', conversation.id, 'members', user.uid));
  if (!membership.exists()) {
    setRoomPrompt('You are not a member of this chat.');
    $('#accept-invite').hidden = true;
    $('#message-text').disabled = true;
    $('#send-message').disabled = true;
    return;
  }
  if (membership.data().status === 'pending') {
    $('#accept-invite').hidden = false;
    $('#message-text').disabled = true;
    $('#send-message').disabled = true;
    setRoomPrompt('You were invited to this chat. Accept the invite to see messages and join in.');
    renderConversationList();
    return;
  }
  $('#accept-invite').hidden = true;
  showActiveRoom(conversation);
}
async function findProfileByNickname(value) {
  const nickname = cleanNickname(value);
  if (nickname.length < 2) throw new Error('Enter a student nickname with at least 2 characters.');
  const results = await getDocs(query(
    collection(db, 'profiles'),
    where('nicknameLower', '==', nickname.toLowerCase()),
    limit(2)
  ));
  if (results.empty) throw new Error('No student found with that nickname. Check the spelling.');
  if (results.size > 1) throw new Error('More than one student uses that nickname. Ask them to choose different nicknames.');
  return { uid: results.docs[0].id, ...results.docs[0].data() };
}
async function createConversation(type, title, invitedProfiles) {
  const people = new Map([[user.uid, { uid: user.uid, nickname: profile.nickname }]]);
  invitedProfiles.forEach((person) => people.set(person.uid, person));
  if (people.size < 2) throw new Error('A chat needs at least one other student.');
  if (people.size > 10) throw new Error('A chat can have up to 10 students.');
  const memberUids = [...people.keys()];
  const pendingUids = memberUids.filter((uid) => uid !== user.uid);
  const ref = doc(collection(db, 'conversations'));
  const batch = writeBatch(db);
  batch.set(ref, {
    type,
    title: title.slice(0, 60),
    createdBy: user.uid,
    memberUids,
    pendingUids,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  people.forEach((person, uid) => {
    batch.set(doc(db, 'conversations', ref.id, 'members', uid), {
      uid,
      nickname: person.nickname,
      status: uid === user.uid ? 'active' : 'pending',
      addedAt: serverTimestamp()
    });
  });
  await batch.commit();
  const newConversation = { id: ref.id, type, title, memberUids, pendingUids };
  await openConversation(newConversation);
  setChatStatus(type === 'group'
    ? 'Group created. Invited students can accept it from their chat list.'
    : 'Private chat created. The other student must accept before seeing messages.');
}
async function startPrivateChat() {
  const target = await findProfileByNickname($('#private-nickname').value);
  if (target.uid === user.uid) throw new Error('Choose another student for a private chat.');
  const existing = await getDocs(query(
    collection(db, 'conversations'),
    where('memberUids', 'array-contains', user.uid),
    limit(50)
  ));
  const current = existing.docs.find((item) => {
    const data = item.data();
    return data.type === 'direct' && data.memberUids.includes(target.uid);
  });
  if (current) {
    await openConversation({ id: current.id, ...current.data() });
    setChatStatus('Opened your private chat.');
    return;
  }
  await createConversation('direct', 'Private chat · ' + target.nickname, [target]);
  $('#private-nickname').value = '';
}
async function createGroupChat() {
  const title = cleanNickname($('#group-title').value);
  if (title.length < 2 || title.length > 60) throw new Error('Give the group a name (2–60 characters).');
  const nicknames = $('#group-invitees').value.split(',').map(cleanNickname).filter(Boolean);
  if (!nicknames.length) throw new Error('Add at least one student nickname.');
  if (nicknames.length > 9) throw new Error('A group can have up to 10 students, including you.');
  const people = await Promise.all(nicknames.map(findProfileByNickname));
  await createConversation('group', title, people);
  $('#group-title').value = '';
  $('#group-invitees').value = '';
}

$('#save-chat-profile').addEventListener('click', async () => {
  const nickname = cleanNickname($('#chat-nickname').value);
  if (!/^[A-Za-z0-9_ -]{2,24}$/.test(nickname)) {
    return setChatStatus('Choose a 2–24 character nickname using letters, numbers, spaces, _ or -.', true);
  }
  setChatBusy(true);
  setChatStatus('Saving your chat nickname…');
  try {
    await setDoc(doc(db, 'profiles', user.uid), {
      nickname,
      nicknameLower: nickname.toLowerCase()
    }, { merge: true });
    profile = { nickname, nicknameLower: nickname.toLowerCase() };
    $('#chat-profile-setup').hidden = true;
    $('#chat-panel').hidden = false;
    setChatStatus('Your nickname is ready. You can start a private chat or make a group.');
    startConversationListener();
  } catch (error) {
    setChatStatus(error.code === 'permission-denied'
      ? 'Firebase rules need to be published before chats can start.'
      : 'Could not save your nickname. Check your Firebase setup.', true);
    console.error(error);
  } finally {
    setChatBusy(false);
  }
});
function startConversationListener() {
  stopConversations?.();
  stopConversations = onSnapshot(
    query(collection(db, 'conversations'), where('memberUids', 'array-contains', user.uid), limit(50)),
    (snapshot) => {
      conversations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderConversationList();
      if (selectedConversation) {
        const refreshed = conversations.find((item) => item.id === selectedConversation.id);
        if (refreshed) selectedConversation = refreshed;
      }
    },
    (error) => {
      setChatStatus(error.code === 'permission-denied'
        ? 'Chats are ready, but Firebase rules need to be published to protect private conversations.'
        : 'Could not load chats. Check your Firebase setup.', true);
      console.error(error);
    }
  );
}
$('#start-private-chat').addEventListener('click', async () => {
  setChatBusy(true);
  setChatStatus('Finding student…');
  try {
    await startPrivateChat();
  } catch (error) {
    setChatStatus(error.message || 'Could not start a private chat.', true);
  } finally {
    setChatBusy(false);
  }
});
$('#create-group-chat').addEventListener('click', async () => {
  setChatBusy(true);
  setChatStatus('Creating group…');
  try {
    await createGroupChat();
  } catch (error) {
    setChatStatus(error.message || 'Could not create the group.', true);
  } finally {
    setChatBusy(false);
  }
});
$('#accept-invite').addEventListener('click', async () => {
  if (!selectedConversation) return;
  setChatBusy(true);
  setChatStatus('Joining chat…');
  try {
    const conversation = selectedConversation;
    const memberRef = doc(db, 'conversations', conversation.id, 'members', user.uid);
    const conversationRef = doc(db, 'conversations', conversation.id);
    const updatedPending = (conversation.pendingUids || []).filter((uid) => uid !== user.uid);
    const batch = writeBatch(db);
    batch.update(memberRef, { status: 'active', acceptedAt: serverTimestamp() });
    batch.update(conversationRef, { pendingUids: updatedPending, updatedAt: serverTimestamp() });
    await batch.commit();
    const fresh = await getDoc(conversationRef);
    await openConversation({ id: fresh.id, ...fresh.data() });
    setChatStatus('You joined the chat.');
  } catch (error) {
    setChatStatus(error.code === 'permission-denied'
      ? 'Firebase rules blocked joining. Check the chat rules in Firebase.'
      : 'Could not join this chat.', true);
    console.error(error);
  } finally {
    setChatBusy(false);
  }
});
$('#message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!user || !profile || !selectedConversation) return;
  const text = $('#message-text').value.trim();
  if (!text) return setChatStatus('Write a message first.', true);
  $('#send-message').disabled = true;
  try {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'conversations', selectedConversation.id, 'messages')), {
      uid: user.uid,
      authorName: profile.nickname,
      text: text.slice(0, 1000),
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, 'conversations', selectedConversation.id), { updatedAt: serverTimestamp() });
    await batch.commit();
    $('#message-text').value = '';
    setChatStatus('Message sent.');
  } catch (error) {
    setChatStatus(error.code === 'permission-denied'
      ? 'Firebase rules blocked this message. Publish the private chat rules first.'
      : 'Could not send the message.', true);
    console.error(error);
  } finally {
    $('#send-message').disabled = !selectedConversation;
  }
});

onAuthStateChanged(auth, async (nextUser) => {
  stopConversations?.();
  stopMessages?.();
  stopConversations = null;
  stopMessages = null;
  conversations = [];
  selectedConversation = null;
  profile = null;
  user = nextUser;
  $('#chat-panel').hidden = true;
  $('#chat-profile-setup').hidden = true;
  $('#chat-room').hidden = true;
  $('#accept-invite').hidden = true;
  if (!user) {
    $('#chat-signin-note').hidden = false;
    setChatStatus('Sign in to make or join private chats.');
    return;
  }
  $('#chat-signin-note').hidden = true;
  setChatStatus('Loading your chat profile…');
  try {
    const profileSnapshot = await getDoc(doc(db, 'profiles', user.uid));
    if (!user || user.uid !== nextUser.uid) return;
    if (profileSnapshot.exists() && profileSnapshot.data().nicknameLower) {
      profile = profileSnapshot.data();
      $('#chat-panel').hidden = false;
      setChatStatus('Choose a private chat or make a group.');
      startConversationListener();
    } else {
      $('#chat-profile-setup').hidden = false;
      $('#chat-nickname').value = user.displayName || '';
      setChatStatus('Choose a nickname other students can find you by.');
    }
  } catch (error) {
    $('#chat-profile-setup').hidden = false;
    $('#chat-nickname').value = user.displayName || '';
    setChatStatus(error.code === 'permission-denied'
      ? 'Firebase rules need the chat profile rules before private chats can start.'
      : 'Could not load your chat profile.', true);
    console.error(error);
  }
});
