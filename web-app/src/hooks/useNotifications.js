import { useState, useEffect } from 'react';
import { db } from '../firebase-config';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';

export const useNotifications = (user) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user || !user.email) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const notificationsRef = collection(db, 'notifications');
    const q = query(
      notificationsRef,
      where('userId', '==', user.email),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const notifs = [];
      let count = 0;
      querySnapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() };
        notifs.push(data);
        if (!data.read) {
          count++;
        }
      });
      setNotifications(notifs);
      setUnreadCount(count);
    });

    return () => unsubscribe();
  }, [user]);

  return { notifications, unreadCount };
};
