import { Point } from "jspdf";
import { useState } from "react";

const StickyNote: React.FC<{
  position: Point;
  onSave: (text: string) => void;
}> = ({ position, onSave }) => {
  const [comment, setComment] = useState('');

  const handleSave = () => {
    if (comment.trim()) {
      onSave(comment);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        backgroundColor: '#fff',
        padding: '10px',
        border: '1px solid #ccc',
        borderRadius: '8px',
        zIndex: 1000,
      }}
    >
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        cols={20}
        placeholder='Enter your comment...'
        className='border p-2'
      />
      <div className='flex justify-between'>
        <button className='text-blue-500' onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
};
export default StickyNote;
