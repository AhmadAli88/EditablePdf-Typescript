/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';
import { Highlighter, Pen, Type } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
// Define types for annotations
type Point = { x: number; y: number };

type HighlightAnnotation = {
  type: 'highlight';
  page: number;
  start: Point;
  end: Point;
  color: string;
};

type DrawingAnnotation = {
  type: 'draw';
  page: number;
  points: Point[];
  color: string;
  width: number;
};

type TextAnnotation = {
  type: 'text';
  page: number;
  position: Point;
  text: string;
  color: string;
};

type Annotation = HighlightAnnotation | DrawingAnnotation | TextAnnotation;

interface PDFViewerProps {
  pdfUrl?: string;
}
interface DrawAnnotation {
  type: 'draw';
  page: number;
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

const PDFViewer: React.FC<PDFViewerProps> = ({
  pdfUrl = 'https://almsbe.xeventechnologies.com/api/s3/file/multiple_quizzes-(2).pdf',
}) => {
  // Refs and State Management
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const pageRef = useRef<any>(null);
  // PDF-related states
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.5);

  // Annotation-related states
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentTool, setCurrentTool] = useState<
    'select' | 'draw' | 'highlight' | 'text'
  >('highlight');
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [highlightInfo, setHighlightInfo] = useState<{
    start: Point;
    current: Point;
  } | null>(null);

  // Error and UI states
  const [error, setError] = useState<string | null>(null);
  const [annotationColor, setAnnotationColor] = useState<string>('#FFFF00');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>('');
  const [modalPosition, setModalPosition] = useState<Point | null>(null);
  
  // PDF Loading Effect
  useEffect(() => {
    const loadPDF = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        renderPage(1, pdf);
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError('Failed to load PDF. Please check the file path.');
      }
    };
    loadPDF();
  }, [pdfUrl]);

  // Memoized render function
  const renderPage = useCallback(
    async (
      pageNumber: number,
      pdfDocument: pdfjsLib.PDFDocumentProxy | null = pdfDoc
    ) => {
      if (!pdfDocument || !canvasRef.current) return;

      // Cancel any ongoing render operation
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      try {
        // Clear previous page
        if (pageRef.current) {
          pageRef.current.cleanup();
        }

        const page = await pdfDocument.getPage(pageNumber);
        pageRef.current = page;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const viewport = page.getViewport({ scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Clear the canvas
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Render PDF page
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;

        // Render annotations after the page is complete
        renderAnnotations();
      } catch (err) {
        console.error('Error rendering page:', err);
        setError('Failed to render page');
      }
    },
    [pdfDoc, scale]
  );

  // Debounced render annotations function
  const renderAnnotations = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Create an offscreen canvas for double buffering
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = canvas.width;
    offscreenCanvas.height = canvas.height;
    const offscreenContext = offscreenCanvas.getContext('2d');

    if (!offscreenContext) return;

    // Copy the main canvas content to offscreen canvas
    offscreenContext.drawImage(canvas, 0, 0);

    // Render existing annotations on the offscreen canvas
    offscreenContext.save();
    offscreenContext.globalCompositeOperation = 'multiply';

    const pageAnnotations = annotations.filter((a) => a.page === pageNum);

    pageAnnotations.forEach((annotation) => {
      switch (annotation.type) {
        case 'highlight':
          offscreenContext.globalAlpha = 0.35;
          renderHighlight(offscreenContext, annotation);
          break;
        case 'draw':
          renderDrawing(offscreenContext, annotation);
          break;
        case 'text':
          renderTextAnnotation(offscreenContext, annotation);
          break;
      }
    });

    // Render current highlight in real-time
    if (currentTool === 'highlight' && highlightInfo) {
      offscreenContext.globalAlpha = 0.35;
      renderCurrentHighlight(offscreenContext);
    }

    // Render current drawing in real-time
    if (currentTool === 'draw' && currentPath.length > 1) {
      renderCurrentDrawing(offscreenContext);
    }

    offscreenContext.restore();

    // Copy the offscreen canvas back to the main canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(offscreenCanvas, 0, 0);
  }, [annotations, pageNum, currentTool, currentPath, highlightInfo]);

  const renderHighlight = (
    context: CanvasRenderingContext2D,
    annotation: HighlightAnnotation
  ) => {
    const { start, end, color } = annotation;
    context.fillStyle = color;
    context.fillRect(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y)
    );
  };

  const renderDrawing = (
    context: CanvasRenderingContext2D,
    annotation: DrawingAnnotation
  ) => {
    context.beginPath();
    context.strokeStyle = annotation.color;
    context.lineWidth = annotation.width;
    annotation.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
  };

  const renderTextAnnotation = (
    context: CanvasRenderingContext2D,
    annotation: TextAnnotation
  ) => {
    context.font = '16px Arial';
    context.fillStyle = annotation.color;
    context.fillText(
      annotation.text,
      annotation.position.x,
      annotation.position.y
    );
  };

  const renderCurrentDrawing = (context: CanvasRenderingContext2D) => {
    context.beginPath();
    context.strokeStyle = annotationColor;
    context.lineWidth = 2;
    currentPath.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
  };

  const renderCurrentHighlight = (context: CanvasRenderingContext2D) => {
    if (!highlightInfo) return;
    const { start, current } = highlightInfo;
    context.fillStyle = annotationColor;
    context.fillRect(
      Math.min(start.x, current.x),
      Math.min(start.y, current.y),
      Math.abs(current.x - start.x),
      Math.abs(current.y - start.y)
    );
  };

  // Optimized event handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      switch (currentTool) {
        case 'draw':
          setIsDrawing(true);
          setCurrentPath([{ x, y }]);
          break;
        case 'highlight':
          setHighlightInfo({ start: { x, y }, current: { x, y } });
          break;
        case 'text':
          handleTextAnnotation(x, y);
          break;
      }
    },
    [currentTool]
  );

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || (currentTool !== 'highlight' && currentTool !== 'draw'))
      return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (currentTool === 'draw' && isDrawing) {
      setCurrentPath((prev) => [...prev, { x, y }]);
      renderAnnotations(); // Redraw annotations and current drawing
    }

    if (currentTool === 'highlight' && highlightInfo) {
      setHighlightInfo((prev) =>
        prev ? { ...prev, current: { x, y } } : null
      );
      renderAnnotations(); // Redraw annotations and current highlight
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (currentTool === 'draw' && isDrawing) {
      const newAnnotation: DrawAnnotation = {
        type: 'draw',
        page: pageNum,
        points: currentPath,
        color: annotationColor,
        width: 2,
      };
      setAnnotations((prev) => [...prev, newAnnotation]);
      setIsDrawing(false);
      setCurrentPath([]);
    }

    if (currentTool === 'highlight' && highlightInfo) {
      const newAnnotation: HighlightAnnotation = {
        type: 'highlight',
        page: pageNum,
        start: highlightInfo.start,
        end: { x, y },
        color: annotationColor,
      };
      setAnnotations((prev) => [...prev, newAnnotation]);
      setHighlightInfo(null);
    }

    renderAnnotations();
  };

  const handleTextAnnotation = (x: number, y: number) => {
    // Store the position and open the modal
    setModalPosition({ x, y });
    setModalText(''); // Clear previous text
    setIsModalOpen(true);
  };
  // Utility Functions
  const clearAllAnnotations = () => {
    setAnnotations([]);
    renderPage(pageNum);
  };

  const hexToRgb = (hex: any) => {
    // Remove the # if present
    hex = hex.replace('#', '');

    // Parse the hex values directly to RGB values between 0 and 1
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    return { r, g, b };
  };
  // Function to handle modal submission
  const handleModalSubmit = () => {
    if (modalText && modalPosition) {
      const newAnnotation: TextAnnotation = {
        type: 'text',
        page: pageNum,
        position: modalPosition,
        text: modalText,
        color: annotationColor,
      };
      setAnnotations((prev) => [...prev, newAnnotation]);
      setIsModalOpen(false);
    }
  };
  
  // Function to handle modal cancellation
  const handleModalCancel = () => {
    setIsModalOpen(false);
  };
  const downloadAnnotatedPDF = async () => {
    try {
      // Fetch the original PDF
      const existingPdfBytes = await fetch(pdfUrl).then((res) =>
        res.arrayBuffer()
      );
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      // Get the current page
      const page = pdfDoc.getPage(pageNum - 1);
      const pageHeight = page.getHeight();
      const pageWidth = page.getWidth();
      const canvas = canvasRef.current;
      const canvasHeight = canvas.height;
      const canvasWidth = canvas.width;

      // Calculate scaling factors
      const scaleX = pageWidth / canvasWidth;
      const scaleY = pageHeight / canvasHeight;

      // Transform canvas coordinates to PDF page coordinates
      const transformCoordinate = (x: any, y: any) => ({
        x: x * scaleX,
        y: pageHeight - y * scaleY,
      });

      // Add annotations to the page
      annotations
        .filter((annotation) => annotation.page === pageNum)
        .forEach((annotation) => {
          switch (annotation.type) {
            case 'highlight': {
              // Convert the user selected color to RGB
              const color = hexToRgb(annotation.color);

              // Transform start and end coordinates
              const start = transformCoordinate(
                annotation.start.x,
                annotation.start.y
              );
              const end = transformCoordinate(
                annotation.end.x,
                annotation.end.y
              );

              page.drawRectangle({
                x: Math.min(start.x, end.x),
                y: Math.min(start.y, end.y),
                width: Math.abs(end.x - start.x),
                height: Math.abs(end.y - start.y),
                color: rgb(color.r, color.g, color.b),
                opacity: 0.35,
              });
              break;
            }
            case 'text': {
              // Convert the user selected color to RGB
              const color = hexToRgb(annotation.color);
              const transformedPos = transformCoordinate(
                annotation.position.x,
                annotation.position.y
              );

              page.drawText(annotation.text, {
                x: transformedPos.x,
                y: transformedPos.y,
                size: 16,
                color: rgb(color.r, color.g, color.b),
              });
              break;
            }
            case 'draw': {
              // Convert the user selected color to RGB
              const color = hexToRgb(annotation.color);

              // Transform points
              const scaledPoints = annotation.points.map((point) =>
                transformCoordinate(point.x, point.y)
              );

              for (let i = 1; i < scaledPoints.length; i++) {
                const prev = scaledPoints[i - 1];
                const curr = scaledPoints[i];
                page.drawLine({
                  start: prev,
                  end: curr,
                  thickness: annotation.width,
                  color: rgb(color.r, color.g, color.b),
                });
              }
              break;
            }
          }
        });

      const pdfBytes = await pdfDoc.save();

      // Download the PDF
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = 'annotated-document.pdf';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (error) {
      console.error('Error downloading annotated PDF:', error);
    }
  };
  // Cleanup effect
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      if (pageRef.current) {
        pageRef.current.cleanup();
      }
    };
  }, []);
  return (
    <div className='w-full max-w-6xl mx-auto p-4'>
      {/* Error Display */}
      {isModalOpen && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
    <div className="bg-white rounded-lg p-6 shadow-lg w-96">
      <h2 className="text-lg font-semibold mb-4">Add Text Annotation</h2>
      <textarea
        className="w-full border border-gray-300 rounded-lg p-2 h-20"
        value={modalText}
        onChange={(e) => setModalText(e.target.value)}
        placeholder="Enter annotation text here..."
      />
      <div className="flex justify-end mt-4 gap-2">
        <button
          className="px-4 py-2 bg-gray-300 text-black rounded hover:bg-gray-400"
          onClick={handleModalCancel}
        >
          Cancel
        </button>
        <button
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          onClick={handleModalSubmit}
        >
          Add
        </button>
      </div>
    </div>
  </div>
)}

      {error && (
        <div className='bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4'>
          {error}
        </div>
      )}

      {/* Flexbox Container */}
      <div className='flex gap-4 custom-height overflow-hidden'>
        {/* PDF Viewer */}
        <div className='flex-grow relative border border-gray-300 rounded custom-boxShadow'>
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`cursor-${
              currentTool === 'highlight'
                ? 'crosshair'
                : currentTool === 'draw'
                ? 'crosshair'
                : currentTool === 'text'
                ? 'text'
                : 'default'
            }`}
          />
        </div>

        {/* Toolbar */}
        <div className='flex-shrink-0 p-4 bg-gray-100 border border-gray-300 rounded custom-boxShadow'>
          <h3 className='text-lg font-bold mb-4'>Tools</h3>

          {/* Tool Selection Buttons */}
          <div className='mb-4 flex flex-col gap-2'>
            <button
              key='highlight'
              className={`px-3 py-2 rounded flex items-center gap-2 ${
                currentTool === 'highlight' ? 'bg-green-700' : 'bg-green-500'
              } text-white hover:bg-green-600`}
              onClick={() => setCurrentTool('highlight')}
              title='Highlight'
            >
              <Highlighter size={18} />
              Highlight
            </button>

            <button
              key='draw'
              className={`px-3 py-2 rounded flex items-center gap-2 ${
                currentTool === 'draw' ? 'bg-purple-700' : 'bg-purple-500'
              } text-white hover:bg-purple-600`}
              onClick={() => setCurrentTool('draw')}
              title='Draw'
            >
              <Pen size={18} />
              Draw
            </button>

            <button
              key='text'
              className={`px-3 py-2 rounded flex items-center gap-2 ${
                currentTool === 'text' ? 'bg-blue-700' : 'bg-blue-500'
              } text-white hover:bg-blue-600`}
              onClick={() => setCurrentTool('text')}
              title='Text Annotation'
            >
              <Type size={18} />
              Text
            </button>
          </div>

          {/* Color Picker */}
          <div className='mb-4'>
            <label className='block text-sm font-medium mb-1'>Color:</label>
            <input
              type='color'
              value={annotationColor}
              onChange={(e) => setAnnotationColor(e.target.value)}
              className='h-10 w-full border border-gray-300 rounded'
            />
          </div>

          {/* Utility Buttons */}
          <div className='flex flex-col gap-2'>
            <button
              className='px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600'
              onClick={clearAllAnnotations}
            >
              Clear All
            </button>
            <button
              className='px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600'
              onClick={downloadAnnotatedPDF}
            >
              Download PDF
            </button>
          </div>
        </div>
      </div>

      {/* Page Navigation */}
      <div className='mt-4 flex justify-center items-center gap-4'>
        <button
          className='px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600'
          onClick={() => {
            const newPage = pageNum - 1;
            if (newPage >= 1) {
              setPageNum(newPage);
              renderPage(newPage);
            }
          }}
          disabled={pageNum <= 1}
        >
          Previous
        </button>
        <span className='py-2'>
          Page {pageNum} of {totalPages}
        </span>
        <button
          className='px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600'
          onClick={() => {
            const newPage = pageNum + 1;
            if (newPage <= totalPages) {
              setPageNum(newPage);
              renderPage(newPage);
            }
          }}
          disabled={pageNum >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default PDFViewer;
